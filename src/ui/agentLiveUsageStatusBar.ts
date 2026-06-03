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

function pickDisplayTokens(agent: AgentSessionInfo): number | undefined {
  const billed =
    (agent.inputTokens ?? 0) +
    (agent.outputTokens ?? 0) +
    (agent.cacheReadTokens ?? 0) +
    (agent.cacheWriteTokens ?? 0);
  if (billed > 0) {
    return billed;
  }
  return agent.streamingTokens;
}

/**
 * Live agent/chat token usage in the status bar (requires MITM proxy + traffic tail).
 */
export class AgentLiveUsageStatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly sessions = new Map<string, AgentSessionInfo>();
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

    if (!mergedAgent || pickDisplayTokens(mergedAgent) == null) {
      return;
    }

    const dollarsPerM = vscode.workspace
      .getConfiguration('cursorAccounts.proxy')
      .get<number>('estimatedDollarsPerMillionTokens', 4);
    const estimatedCostUsd =
      estimateTokenCostUsd(mergedAgent, dollarsPerM) ??
      mergedAgent.estimatedCostUsd;

    const prev = this.sessions.get(sessionId);
    this.sessions.set(
      sessionId,
      mergeAgentSessionInfo(prev, {
        ...mergedAgent,
        estimatedCostUsd,
      }) ?? mergedAgent
    );
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
    if (!this.isEnabled() || !this.activeSessionId) {
      this.item.hide();
      return;
    }

    const agent = this.sessions.get(this.activeSessionId);
    if (!agent) {
      this.item.hide();
      return;
    }

    const total = pickDisplayTokens(agent);
    if (total == null || total <= 0) {
      this.item.hide();
      return;
    }

    const tokenLabel = formatTokenCount(total);
    const parts: string[] = [
      t('agentLiveUsage.statusBar.tokens', { count: tokenLabel }),
    ];

    if (agent.inputTokens != null && agent.outputTokens != null) {
      parts.push(
        t('agentLiveUsage.statusBar.inOut', {
          input: formatTokenCount(agent.inputTokens),
          output: formatTokenCount(agent.outputTokens),
        })
      );
    }

    const cost =
      agent.estimatedCostUsd ??
      estimateTokenCostUsd(
        agent,
        vscode.workspace
          .getConfiguration('cursorAccounts.proxy')
          .get<number>('estimatedDollarsPerMillionTokens', 4)
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
    this.item.tooltip = this.buildTooltip(agent, total, cost);
    this.item.show();
  }

  private buildTooltip(
    agent: AgentSessionInfo,
    total: number,
    cost: number | undefined
  ): string {
    const lines = [
      t('agentLiveUsage.tooltip.title'),
      t('agentLiveUsage.tooltip.total', { count: String(total) }),
    ];
    if (agent.streamingTokens != null) {
      lines.push(
        t('agentLiveUsage.tooltip.streaming', {
          count: String(agent.streamingTokens),
        })
      );
    }
    if (agent.inputTokens != null || agent.outputTokens != null) {
      lines.push(
        t('agentLiveUsage.tooltip.turn', {
          input: String(agent.inputTokens ?? 0),
          output: String(agent.outputTokens ?? 0),
        })
      );
    }
    if (agent.cacheReadTokens != null || agent.cacheWriteTokens != null) {
      lines.push(
        t('agentLiveUsage.tooltip.cache', {
          read: String(agent.cacheReadTokens ?? 0),
          write: String(agent.cacheWriteTokens ?? 0),
        })
      );
    }
    if (cost != null) {
      lines.push(t('agentLiveUsage.tooltip.estimatedCost'));
    }
    if (agent.usageUuid) {
      lines.push(t('agentLiveUsage.tooltip.usageUuid', { id: agent.usageUuid }));
    }
    if (agent.requestId) {
      lines.push(t('agentLiveUsage.tooltip.requestId', { id: agent.requestId }));
    }
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
