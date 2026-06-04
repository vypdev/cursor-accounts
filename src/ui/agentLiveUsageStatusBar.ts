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

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}m`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(Math.round(n));
}

interface SessionState {
  agent: AgentSessionInfo;
  cumulativeBaseline: number; // sum of completed turn peaks
  currentPeak: number; // highest streamingTokens in current turn
  lastActivity: number; // timestamp for cleanup
}

/**
 * Live agent/chat token usage in the status bar (requires MITM proxy + traffic tail).
 */
export class AgentLiveUsageStatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly sessions = new Map<string, SessionState>();
  private activeSessionId: string | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

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
    if (!agent && !tokens) {
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

    if (!mergedAgent) {
      return;
    }

    const dollarsPerM = vscode.workspace
      .getConfiguration('cursorAccounts.proxy')
      .get<number>('estimatedDollarsPerMillionTokens', 4);

    // Reset detection for cumulative token tracking
    const prev = this.sessions.get(sessionId);
    const newStreamingTokens = mergedAgent.streamingTokens;

    let cumulativeBaseline = prev?.cumulativeBaseline ?? 0;
    let currentPeak = prev?.currentPeak ?? 0;

    // Detect counter reset: peak was significant (≥300) and new value drops to ≤150
    const RESET_PEAK_THRESHOLD = 300;
    const RESET_DROP_THRESHOLD = 150;

    if (newStreamingTokens != null) {
      if (
        currentPeak >= RESET_PEAK_THRESHOLD &&
        newStreamingTokens <= RESET_DROP_THRESHOLD
      ) {
        // Counter reset detected: accumulate previous peak, start new turn
        cumulativeBaseline += currentPeak;
        currentPeak = newStreamingTokens;
      } else if (newStreamingTokens > currentPeak) {
        // Counter increased within current turn
        currentPeak = newStreamingTokens;
      }
      // If newStreamingTokens < currentPeak but no reset detected, keep existing peak
    }

    // Merge with previous agent data
    const finalAgent = mergeAgentSessionInfo(prev?.agent, {
      ...mergedAgent,
      estimatedCostUsd: estimateTokenCostUsd(mergedAgent, dollarsPerM) ?? mergedAgent.estimatedCostUsd,
    }) ?? mergedAgent;

    this.sessions.set(sessionId, {
      agent: finalAgent,
      cumulativeBaseline,
      currentPeak,
      lastActivity: Date.now(),
    });

    this.activeSessionId = sessionId;
    this.refreshDisplay();
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
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('cursorAccounts.proxy')
      .get<boolean>('showLiveUsageInStatusBar', true);
  }

  private refreshDisplay(): void {
    if (!this.isEnabled() || this.sessions.size === 0) {
      this.item.hide();
      return;
    }

    // Sum tokens across all active sessions (handles parallel agents)
    let totalStreamingTokens = 0;
    let totalBilled = 0;
    let totalCost = 0;
    let sessionCount = 0;

    for (const sessionState of this.sessions.values()) {
      const agent = sessionState.agent;
      sessionCount++;

      // Accumulate streaming tokens (baseline + current peak for each session)
      totalStreamingTokens += sessionState.cumulativeBaseline + sessionState.currentPeak;

      // Accumulate billed tokens if available
      const billed =
        (agent.inputTokens ?? 0) +
        (agent.outputTokens ?? 0) +
        (agent.cacheReadTokens ?? 0) +
        (agent.cacheWriteTokens ?? 0);
      totalBilled += billed;

      // Sum costs
      if (agent.estimatedCostUsd != null) {
        totalCost += agent.estimatedCostUsd;
      }
    }

    // Display total across all sessions
    const total = totalBilled > 0 ? totalBilled : totalStreamingTokens;

    if (total <= 0) {
      this.item.hide();
      return;
    }

    const tokenLabel = formatTokenCount(total);
    const parts: string[] = [
      t('agentLiveUsage.statusBar.tokens', { count: tokenLabel }),
    ];

    // Show aggregated in/out if we have billed tokens
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

    // Estimate cost if not already calculated
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
              streamingTokens: totalBilled > 0 ? undefined : totalStreamingTokens,
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

    // Show per-session breakdown
    for (const [sessionId, sessionState] of this.sessions.entries()) {
      const agent = sessionState.agent;
      const sessionTotal = sessionState.cumulativeBaseline + sessionState.currentPeak;

      lines.push('');
      lines.push(
        `Session ${sessionId.slice(0, 8)}: ${sessionTotal} tokens (baseline: ${sessionState.cumulativeBaseline}, current: ${sessionState.currentPeak})`
      );

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
        lines.push(`  ${t('agentLiveUsage.tooltip.usageUuid', { id: agent.usageUuid })}`);
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
