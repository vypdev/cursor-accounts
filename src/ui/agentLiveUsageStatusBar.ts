import * as vscode from 'vscode';
import { ProxyLiveCostCalculator } from '../domain/services/ProxyLiveCostCalculator';
import { CursorModelPricingProvider } from '../modelEfficiency/cursorModelPricingProvider';
import {
  mergeAgentSessionInfo,
  type AgentSessionInfo,
} from '../proxy/proxyInsightExtractor';
import type { ProxyTrafficSummary } from '../proxy/types';
import { t } from '../l10n';

const IDLE_HIDE_MS = 300_000;
/** Just left of quota item (priority 100). */
const STATUS_PRIORITY = 99;
/** Throttle status bar redraws during token_delta bursts (CLI uses ~de.Zx ms). */
const DISPLAY_THROTTLE_MS = 150;

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}m`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(Math.round(n));
}

function billedTokenTotal(agent: AgentSessionInfo): number {
  return (
    (agent.inputTokens ?? 0) +
    (agent.outputTokens ?? 0) +
    (agent.cacheReadTokens ?? 0) +
    (agent.cacheWriteTokens ?? 0)
  );
}

function formatCostUsd(costCents: number, authoritative: boolean): string {
  const costUsd = costCents / 100;
  if (costUsd < 0.01) {
    return '<$0.01';
  }
  const label = `$${costUsd.toFixed(2)}`;
  return authoritative ? label : `~${label}`;
}

interface SessionState {
  agent: AgentSessionInfo;
  /** CLI-style sum of token_delta during current turn (UI only). */
  liveAccumulated: number;
  /** Sum of per-delta model-aware costs during current turn (USD cents). */
  liveAccumulatedCostCents: number;
  /** Billing-grade total from server turn_ended. */
  billedTokens: number;
  /** Turn cost in USD cents (server or calculated). */
  turnTotalCents?: number;
  /** True when turnTotalCents came from server total_cents. */
  turnCostFromServer?: boolean;
  /** Active model id for this session. */
  modelId?: string;
  lastActivity: number;
  /** True when billing-grade turn_ended came from live proxy decode (API). */
  turnEndedFromLive?: boolean;
}

/**
 * Live agent/chat token usage in the status bar (requires MITM proxy + live API traffic).
 */
export class AgentLiveUsageStatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly sessions = new Map<string, SessionState>();
  private readonly costCalculator: ProxyLiveCostCalculator;
  private activeSessionId: string | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshThrottleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.costCalculator = new ProxyLiveCostCalculator(
      new CursorModelPricingProvider(),
      () =>
        vscode.workspace
          .getConfiguration('cursorAccounts.proxy')
          .get<number>('estimatedDollarsPerMillionTokens', 4)
    );

    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      STATUS_PRIORITY
    );
    this.item.name = 'cursorAccounts.agentLiveUsage';
    this.item.command = 'cursorAccounts.proxy.showOutput';
    context.subscriptions.push(this.item);
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('cursorAccounts.proxy')) {
          this.refreshDisplay();
        }
      })
    );
    context.subscriptions.push({ dispose: () => this.dispose() });
  }

  ingest(summary: ProxyTrafficSummary): void {
    if (!this.isEnabled()) {
      return;
    }

    const agent = summary.insights?.agent;
    const tokens = summary.insights?.tokens;
    if (!agent && !tokens && !summary.liveTokenData) {
      return;
    }

    const sessionId =
      agent?.requestId ??
      this.activeSessionId ??
      summary.requestId ??
      'active';

    let mergedAgent = mergeAgentSessionInfo(agent, {
      inputTokens: tokens?.promptTokens ?? agent?.inputTokens,
      outputTokens: tokens?.completionTokens ?? agent?.outputTokens,
      cacheReadTokens: tokens?.cachedTokens ?? agent?.cacheReadTokens,
      totalCents: tokens?.totalCents ?? agent?.totalCents,
      requestedModelId: agent?.requestedModelId ?? agent?.modelName,
      streamingTokens:
        agent?.streamingTokens ??
        (tokens?.totalTokens != null &&
        tokens.promptTokens == null &&
        tokens.completionTokens == null
          ? tokens.totalTokens
          : undefined),
    });

    if (
      mergedAgent &&
      tokens?.totalTokens != null &&
      (mergedAgent.streamingTokens == null ||
        tokens.totalTokens > mergedAgent.streamingTokens)
    ) {
      mergedAgent = mergeAgentSessionInfo(mergedAgent, {
        streamingTokens: tokens.totalTokens,
        usageEvent: agent?.usageEvent ?? 'token_delta',
      });
    }

    if (!mergedAgent && summary.liveTokenData) {
      mergedAgent = {
        streamingTokens: summary.liveTokenData.accumulatedTokens,
        usageEvent: 'token_delta',
      };
    }

    if (!mergedAgent) {
      return;
    }

    const prev = this.sessions.get(sessionId);

    if (
      prev?.turnEndedFromLive &&
      !summary.isTurnEnded &&
      !summary.isLiveTokenUpdate &&
      mergedAgent.usageEvent === 'turn_ended'
    ) {
      return;
    }

    const modelId =
      summary.liveTokenData?.modelId ??
      mergedAgent.requestedModelId ??
      mergedAgent.modelName ??
      prev?.modelId;

    let liveAccumulated = prev?.liveAccumulated ?? 0;
    let liveAccumulatedCostCents = prev?.liveAccumulatedCostCents ?? 0;
    let billedTokens = prev?.billedTokens ?? 0;
    let turnTotalCents = prev?.turnTotalCents;
    let turnCostFromServer = prev?.turnCostFromServer;

    const isTurnEndedEvent =
      summary.isTurnEnded === true || mergedAgent.usageEvent === 'turn_ended';
    const acceptTurnEnded =
      isTurnEndedEvent && (summary.isTurnEnded === true || !prev?.turnEndedFromLive);

    if (summary.isLiveTokenUpdate && summary.liveTokenData) {
      liveAccumulated = summary.liveTokenData.accumulatedTokens;
      if (summary.liveTokenData.latestDelta > 0) {
        const deltaCost =
          summary.liveTokenData.deltaCostCents ??
          this.costCalculator.calculateDeltaCost(
            summary.liveTokenData.latestDelta,
            modelId
          );
        liveAccumulatedCostCents += deltaCost;
      }
    } else if (acceptTurnEnded) {
      const billed = billedTokenTotal(mergedAgent);
      if (billed > 0) {
        billedTokens = billed;
      }
      liveAccumulated = 0;
      liveAccumulatedCostCents = 0;

      const serverCents = tokens?.totalCents;
      if (serverCents != null && serverCents > 0) {
        turnTotalCents = serverCents;
        turnCostFromServer = true;
      } else if (mergedAgent.totalCents != null && mergedAgent.totalCents > 0) {
        turnTotalCents = mergedAgent.totalCents;
        turnCostFromServer = false;
      } else {
        turnTotalCents = this.costCalculator.calculateTurnCost(
          {
            inputTokens: mergedAgent.inputTokens ?? 0,
            outputTokens: mergedAgent.outputTokens ?? 0,
            cacheReadTokens: mergedAgent.cacheReadTokens,
            cacheWriteTokens: mergedAgent.cacheWriteTokens,
          },
          modelId
        );
        turnCostFromServer = false;
      }
    } else if (mergedAgent.streamingTokens != null) {
      liveAccumulated = Math.max(
        liveAccumulated,
        mergedAgent.streamingTokens
      );
    }

    if (modelId) {
      mergedAgent = mergeAgentSessionInfo(mergedAgent, {
        requestedModelId: modelId,
      }) ?? mergedAgent;
    }

    const finalAgent =
      mergeAgentSessionInfo(prev?.agent, mergedAgent) ?? mergedAgent;

    this.sessions.set(sessionId, {
      agent: finalAgent,
      liveAccumulated,
      liveAccumulatedCostCents,
      billedTokens,
      turnTotalCents,
      turnCostFromServer,
      modelId,
      lastActivity: Date.now(),
      turnEndedFromLive:
        summary.isTurnEnded === true || prev?.turnEndedFromLive === true,
    });

    this.activeSessionId = sessionId;

    if (summary.isLiveTokenUpdate) {
      this.scheduleThrottledRefresh();
    } else {
      this.refreshDisplay();
    }
    this.scheduleIdleHide();
  }

  clear(): void {
    this.sessions.clear();
    this.activeSessionId = undefined;
    this.item.backgroundColor = undefined;
    this.item.hide();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (this.refreshThrottleTimer) {
      clearTimeout(this.refreshThrottleTimer);
      this.refreshThrottleTimer = undefined;
    }
  }

  dispose(): void {
    this.clear();
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('cursorAccounts.proxy')
      .get<boolean>('showLiveUsageInStatusBar', true);
  }

  private scheduleThrottledRefresh(): void {
    if (this.refreshThrottleTimer) {
      return;
    }
    this.refreshThrottleTimer = setTimeout(() => {
      this.refreshThrottleTimer = undefined;
      this.refreshDisplay();
    }, DISPLAY_THROTTLE_MS);
  }

  private refreshDisplay(): void {
    if (!this.isEnabled() || this.sessions.size === 0) {
      this.item.hide();
      return;
    }

    let totalStreamingTokens = 0;
    let totalBilled = 0;
    let totalLiveCostCents = 0;
    let totalTurnCostCents = 0;
    let hasAuthoritativeTurnCost = false;
    let sessionCount = 0;

    for (const sessionState of this.sessions.values()) {
      const agent = sessionState.agent;
      sessionCount++;

      const sessionLive = sessionState.liveAccumulated;
      const sessionBilled = sessionState.billedTokens;
      totalStreamingTokens += sessionLive > 0 ? sessionLive : sessionBilled;
      totalBilled += sessionBilled > 0 ? sessionBilled : billedTokenTotal(agent);

      if (sessionState.turnTotalCents != null && sessionState.turnTotalCents > 0) {
        totalTurnCostCents += sessionState.turnTotalCents;
        if (sessionState.turnCostFromServer) {
          hasAuthoritativeTurnCost = true;
        }
      } else {
        totalLiveCostCents += sessionState.liveAccumulatedCostCents;
      }
    }

    const total =
      totalBilled > 0 ? totalBilled : totalStreamingTokens;

    if (total <= 0 && totalLiveCostCents <= 0 && totalTurnCostCents <= 0) {
      this.item.hide();
      return;
    }

    const parts: string[] = [];
    if (total > 0) {
      parts.push(formatTokenCount(total));
    }

    const displayCostCents =
      totalTurnCostCents > 0 ? totalTurnCostCents : totalLiveCostCents;
    const costAuthoritative =
      totalTurnCostCents > 0 && hasAuthoritativeTurnCost;

    if (displayCostCents > 0) {
      parts.push(
        t('agentLiveUsage.statusBar.estimatedCost', {
          cost: formatCostUsd(displayCostCents, costAuthoritative),
        })
      );
    } else if (total >= 100) {
      parts.push(
        t('agentLiveUsage.statusBar.estimatedCost', { cost: '<$0.01' })
      );
    }

    this.item.text = `$(symbol-event) ${parts.join(' · ')}`;
    this.item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground'
    );
    this.item.tooltip = this.buildTooltip(
      total,
      displayCostCents > 0 ? displayCostCents / 100 : undefined,
      sessionCount,
      costAuthoritative
    );
    this.item.show();
  }

  private buildTooltip(
    total: number,
    costUsd: number | undefined,
    sessionCount: number,
    costAuthoritative: boolean
  ): string {
    const lines = [
      t('agentLiveUsage.tooltip.title'),
      t('agentLiveUsage.tooltip.total', { count: String(total) }),
    ];

    if (sessionCount > 1) {
      lines.push(`Active sessions: ${sessionCount}`);
    }

    for (const [sessionId, sessionState] of this.sessions.entries()) {
      const agent = sessionState.agent;
      const sessionTotal =
        sessionState.liveAccumulated > 0
          ? sessionState.liveAccumulated
          : sessionState.billedTokens;

      lines.push('');
      lines.push(
        `Session ${sessionId.slice(0, 8)}: ${sessionTotal} tokens (live: ${sessionState.liveAccumulated}, billed: ${sessionState.billedTokens})`
      );

      if (sessionState.modelId) {
        lines.push(`  Model: ${sessionState.modelId}`);
      }

      if (sessionState.liveAccumulatedCostCents > 0) {
        lines.push(
          `  Live cost: ${formatCostUsd(sessionState.liveAccumulatedCostCents, false)}`
        );
      }

      if (sessionState.turnTotalCents != null && sessionState.turnTotalCents > 0) {
        lines.push(
          `  Turn cost: ${formatCostUsd(
            sessionState.turnTotalCents,
            sessionState.turnCostFromServer === true
          )}`
        );
      }

      if (agent.inputTokens != null || agent.outputTokens != null) {
        lines.push(
          `  ${t('agentLiveUsage.tooltip.turn', {
            input: String(agent.inputTokens ?? 0),
            output: String(agent.outputTokens ?? 0),
          })}`
        );
      }

      if (agent.cacheReadTokens != null || agent.cacheWriteTokens != null) {
        lines.push(
          `  ${t('agentLiveUsage.tooltip.cache', {
            read: String(agent.cacheReadTokens ?? 0),
            write: String(agent.cacheWriteTokens ?? 0),
          })}`
        );
      }

      if (agent.usageUuid) {
        lines.push(
          `  ${t('agentLiveUsage.tooltip.usageUuid', { id: agent.usageUuid })}`
        );
      }
    }

    if (costUsd != null) {
      lines.push('');
      lines.push(
        costAuthoritative
          ? 'Turn cost from server (total_cents).'
          : t('agentLiveUsage.tooltip.estimatedCost')
      );
    }

    lines.push('');
    lines.push(t('agentLiveUsage.tooltip.hint'));
    return lines.join('\n');
  }

  private scheduleIdleHide(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.clear();
    }, IDLE_HIDE_MS);
  }
}
