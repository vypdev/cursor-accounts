import * as vscode from 'vscode';
import {
  AgentLiveUsageState,
  getBilledTokenTotal,
  type AgentLiveUsageSessionState,
} from '../application/services/agentLiveUsageState';
import { ProxyLiveCostCalculator } from '../domain/services/ProxyLiveCostCalculator';
import { CursorModelPricingProvider } from '../modelEfficiency/cursorModelPricingProvider';
import { mergeAgentSessionInfo } from '../proxy/proxyInsightExtractor';
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

function formatCostUsd(costCents: number, authoritative: boolean): string {
  const costUsd = costCents / 100;
  if (costUsd < 0.01) {
    return '<$0.01';
  }
  const label = `$${costUsd.toFixed(2)}`;
  return authoritative ? label : `~${label}`;
}

/**
 * Live agent/chat token usage in the status bar (requires MITM proxy + live API traffic).
 */
export class AgentLiveUsageStatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly costCalculator: ProxyLiveCostCalculator;
  private readonly usageState: AgentLiveUsageState;
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
    this.usageState = new AgentLiveUsageState({
      mergeAgentSessionInfo,
      costCalculator: this.costCalculator,
    });

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

  private get sessions(): ReadonlyMap<string, AgentLiveUsageSessionState> {
    return this.usageState.sessions;
  }

  ingest(summary: ProxyTrafficSummary): void {
    if (!this.isEnabled()) {
      return;
    }
    if (!this.usageState.ingest(summary)) {
      return;
    }

    if (summary.isLiveTokenUpdate) {
      this.scheduleThrottledRefresh();
    } else {
      this.refreshDisplay();
    }
    this.scheduleIdleHide();
  }

  clear(): void {
    this.usageState.clear();
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
    let hasTurnCost = false;
    let sessionCount = 0;

    for (const sessionState of this.sessions.values()) {
      const agent = sessionState.agent;
      sessionCount++;

      const sessionLive = sessionState.liveAccumulated;
      const sessionBilled = sessionState.billedTokens;
      totalStreamingTokens += sessionLive > 0 ? sessionLive : sessionBilled;
      totalBilled +=
        sessionBilled > 0 ? sessionBilled : getBilledTokenTotal(agent);

      if (sessionState.turnTotalCents != null) {
        hasTurnCost = true;
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

    if (total <= 0 && totalLiveCostCents <= 0 && !hasTurnCost) {
      this.item.hide();
      return;
    }

    const parts: string[] = [];
    if (total > 0) {
      parts.push(formatTokenCount(total));
    }

    const displayCostCents = hasTurnCost
      ? totalTurnCostCents
      : totalLiveCostCents;
    const costAuthoritative =
      hasTurnCost && hasAuthoritativeTurnCost;

    if (displayCostCents > 0 || hasTurnCost) {
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
      hasTurnCost || displayCostCents > 0
        ? displayCostCents / 100
        : undefined,
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

      if (sessionState.turnTotalCents != null) {
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
