import * as vscode from 'vscode';
import {
  estimateTokenCostUsd,
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

function formatContextPercent(used: number, max: number): string {
  if (max <= 0) {
    return '';
  }
  const pct = Math.max(0, Math.min(100, Math.round((used / max) * 1000) / 10));
  return pct % 1 === 0 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}

function billedTokenTotal(agent: AgentSessionInfo): number {
  return (
    (agent.inputTokens ?? 0) +
    (agent.outputTokens ?? 0) +
    (agent.cacheReadTokens ?? 0) +
    (agent.cacheWriteTokens ?? 0)
  );
}

interface SessionState {
  agent: AgentSessionInfo;
  /** CLI-style sum of token_delta during current turn (UI only). */
  liveAccumulated: number;
  /** Billing-grade total from server turn_ended. */
  billedTokens: number;
  lastActivity: number;
}

/**
 * Live agent/chat token usage in the status bar (requires MITM proxy + traffic tail).
 */
export class AgentLiveUsageStatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly sessions = new Map<string, SessionState>();
  private activeSessionId: string | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshThrottleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(context: vscode.ExtensionContext) {
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

    const dollarsPerM = vscode.workspace
      .getConfiguration('cursorAccounts.proxy')
      .get<number>('estimatedDollarsPerMillionTokens', 4);

    const prev = this.sessions.get(sessionId);
    let liveAccumulated = prev?.liveAccumulated ?? 0;
    let billedTokens = prev?.billedTokens ?? 0;

    if (summary.isLiveTokenUpdate && summary.liveTokenData) {
      liveAccumulated = summary.liveTokenData.accumulatedTokens;
    } else if (summary.isTurnEnded || mergedAgent.usageEvent === 'turn_ended') {
      const billed = billedTokenTotal(mergedAgent);
      if (billed > 0) {
        billedTokens = billed;
      }
      liveAccumulated = 0;
    } else if (mergedAgent.streamingTokens != null) {
      liveAccumulated = Math.max(
        liveAccumulated,
        mergedAgent.streamingTokens
      );
    }

    const finalAgent = mergeAgentSessionInfo(prev?.agent, {
      ...mergedAgent,
      estimatedCostUsd:
        estimateTokenCostUsd(mergedAgent, dollarsPerM) ??
        mergedAgent.estimatedCostUsd,
    }) ?? mergedAgent;

    this.sessions.set(sessionId, {
      agent: finalAgent,
      liveAccumulated,
      billedTokens,
      lastActivity: Date.now(),
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
    let totalCost = 0;
    let sessionCount = 0;
    let bestContextPercent: string | undefined;

    for (const sessionState of this.sessions.values()) {
      const agent = sessionState.agent;
      sessionCount++;

      if (
        agent.contextUsedTokens != null &&
        agent.maxTokens != null &&
        agent.maxTokens > 0
      ) {
        const pct = formatContextPercent(
          agent.contextUsedTokens,
          agent.maxTokens
        );
        if (pct) {
          bestContextPercent = pct;
        }
      }

      const sessionLive = sessionState.liveAccumulated;
      const sessionBilled = sessionState.billedTokens;
      totalStreamingTokens += sessionLive > 0 ? sessionLive : sessionBilled;
      totalBilled += sessionBilled > 0 ? sessionBilled : billedTokenTotal(agent);

      if (agent.estimatedCostUsd != null) {
        totalCost += agent.estimatedCostUsd;
      }
    }

    const total =
      totalBilled > 0 ? totalBilled : totalStreamingTokens;

    if (total <= 0 && !bestContextPercent) {
      this.item.hide();
      return;
    }

    const parts: string[] = [];
    if (bestContextPercent) {
      parts.push(bestContextPercent);
    }
    if (total > 0) {
      const tokenLabel = formatTokenCount(total);
      parts.push(t('agentLiveUsage.statusBar.tokens', { count: tokenLabel }));
    }

    if (totalBilled > 0) {
      const totalInput = Array.from(this.sessions.values()).reduce(
        (sum, s) => sum + (s.agent.inputTokens ?? 0),
        0
      );
      const totalOutput = Array.from(this.sessions.values()).reduce(
        (sum, s) => sum + (s.agent.outputTokens ?? 0),
        0
      );

      if (totalInput > 0 || totalOutput > 0) {
        parts.push(
          t('agentLiveUsage.statusBar.inOut', {
            input: formatTokenCount(totalInput),
            output: formatTokenCount(totalOutput),
          })
        );
      }
    }

    const dollarsPerM = vscode.workspace
      .getConfiguration('cursorAccounts.proxy')
      .get<number>('estimatedDollarsPerMillionTokens', 4);

    const cost =
      totalCost > 0
        ? totalCost
        : estimateTokenCostUsd(
            {
              inputTokens: totalBilled > 0 ? totalBilled / 2 : undefined,
              outputTokens: totalBilled > 0 ? totalBilled / 2 : undefined,
              streamingTokens:
                totalBilled > 0 ? undefined : totalStreamingTokens,
            },
            dollarsPerM
          );

    if (cost != null && cost > 0) {
      parts.push(
        t('agentLiveUsage.statusBar.estimatedCost', {
          cost: cost < 0.01 ? '<$0.01' : `~$${cost.toFixed(2)}`,
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
    this.item.tooltip = this.buildTooltip(total, cost, sessionCount);
    this.item.show();
  }

  private buildTooltip(
    total: number,
    cost: number | undefined,
    sessionCount: number
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

      if (agent.inputTokens != null || agent.outputTokens != null) {
        lines.push(
          `  ${t('agentLiveUsage.tooltip.turn', {
            input: String(agent.inputTokens ?? 0),
            output: String(agent.outputTokens ?? 0),
          })}`
        );
      }

      if (agent.contextUsedTokens != null && agent.maxTokens != null) {
        lines.push(
          `  Context: ${formatContextPercent(agent.contextUsedTokens, agent.maxTokens)} (${agent.contextUsedTokens}/${agent.maxTokens})`
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

    if (cost != null) {
      lines.push('');
      lines.push(t('agentLiveUsage.tooltip.estimatedCost'));
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
