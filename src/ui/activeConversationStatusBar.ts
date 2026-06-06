import * as vscode from 'vscode';
import type { ConversationTokenTotals } from '../application/types/agentPersistence';
import type { ActiveConversationState } from '../application/types/activeConversation';
import type { ActiveConversationTracker } from '../services/activeConversationTracker';
import { t } from '../l10n';

/** Left of live agent usage (priority 99) and quota (100). */
const STATUS_PRIORITY = 98;
const DISPLAY_THROTTLE_MS = 150;

export type ConversationTotalsLoader = (
  conversationId: string,
  profileId?: string
) => Promise<ConversationTokenTotals | null>;

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}m`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(Math.round(n));
}

export function formatContextPercent(used: number, max: number): string {
  if (max <= 0) {
    return '';
  }
  const pct = Math.max(0, Math.min(100, Math.round((used / max) * 1000) / 10));
  return pct % 1 === 0 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}

function formatCostUsd(costCents: number, authoritative: boolean): string {
  const costUsd = costCents / 100;
  if (costUsd < 0.01) {
    return '<$0.01';
  }
  const label = `$${costUsd.toFixed(2)}`;
  return authoritative ? label : `~${label}`;
}

export function resolveConversationDisplayTotals(
  totals: ConversationTokenTotals
): {
  tokens: number;
  costCents: number;
  costAuthoritative: boolean;
} {
  const liveTokens = totals.totalDeltaTokens;
  const billedTokens = totals.totalTokens;
  const tokens = Math.max(liveTokens, billedTokens);

  const liveCost = totals.totalDeltaCostCents;
  const billedCost = totals.totalTurnCostCents;
  const useBilledCost = billedCost > 0 && billedCost >= liveCost;
  const costCents = useBilledCost ? billedCost : liveCost;

  return {
    tokens,
    costCents,
    costAuthoritative: useBilledCost && billedCost > 0,
  };
}

export class ActiveConversationStatusBar {
  private readonly item: vscode.StatusBarItem;
  private currentState: ActiveConversationState | null = null;
  private currentTotals: ConversationTokenTotals | null = null;
  private lastProfileId: string | undefined;
  private unsubscribe?: () => void;
  private refreshThrottleTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshGeneration = 0;

  constructor(
    context: vscode.ExtensionContext,
    private readonly tracker: ActiveConversationTracker,
    private readonly loadTotals: ConversationTotalsLoader
  ) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      STATUS_PRIORITY
    );
    this.item.name = 'cursorAccounts.activeConversation';
    this.item.command = 'cursorAccounts.debug.copyActiveConversationId';
    context.subscriptions.push(this.item);
    context.subscriptions.push({
      dispose: () => this.dispose(),
    });

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('cursorAccounts.debug')) {
          this.applyVisibility();
        }
      })
    );
  }

  start(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.tracker.onChange((state) => {
      this.currentState = state;
      void this.refreshTotals();
    });
    this.applyVisibility();
    void this.tracker.tickNow();
  }

  notifyUsagePersisted(conversationId: string, profileId?: string): void {
    if (profileId) {
      this.lastProfileId = profileId;
    }
    const activeId = this.currentState?.lastFocusedComposerId;
    if (!activeId || activeId !== conversationId) {
      return;
    }
    this.scheduleThrottledRefresh();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.refreshThrottleTimer) {
      clearTimeout(this.refreshThrottleTimer);
      this.refreshThrottleTimer = undefined;
    }
    this.item.hide();
  }

  getCurrentState(): ActiveConversationState | null {
    return this.currentState;
  }

  getCurrentTotals(): ConversationTokenTotals | null {
    return this.currentTotals;
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('cursorAccounts.debug')
      .get<boolean>('showActiveConversationInStatusBar', true);
  }

  private applyVisibility(): void {
    if (!this.isEnabled()) {
      this.item.hide();
      return;
    }
    this.refreshDisplay();
  }

  private scheduleThrottledRefresh(): void {
    if (this.refreshThrottleTimer) {
      return;
    }
    this.refreshThrottleTimer = setTimeout(() => {
      this.refreshThrottleTimer = undefined;
      void this.refreshTotals();
    }, DISPLAY_THROTTLE_MS);
  }

  private async refreshTotals(): Promise<void> {
    if (!this.isEnabled()) {
      this.item.hide();
      return;
    }

    const conversationId = this.currentState?.lastFocusedComposerId;
    if (!conversationId) {
      this.currentTotals = null;
      this.refreshDisplay();
      return;
    }

    const generation = ++this.refreshGeneration;
    try {
      const totals = await this.loadTotals(conversationId, this.lastProfileId);
      if (generation !== this.refreshGeneration) {
        return;
      }
      this.currentTotals = totals;
    } catch {
      if (generation !== this.refreshGeneration) {
        return;
      }
      this.currentTotals = null;
    }
    this.refreshDisplay();
  }

  private refreshDisplay(): void {
    if (!this.isEnabled()) {
      this.item.hide();
      return;
    }

    const id = this.currentState?.lastFocusedComposerId;
    if (!id) {
      this.item.text = `$(comment-discussion) ${t('activeConversation.statusBar.none')}`;
      this.item.tooltip = t('activeConversation.tooltip.none');
      this.item.backgroundColor = undefined;
      this.item.show();
      return;
    }

    const parts: string[] = [`${id.slice(0, 8)}`];

    const contextPercent = this.getContextPercentLabel();
    if (contextPercent) {
      parts.push(contextPercent);
    }

    if (this.currentTotals) {
      const { tokens, costCents, costAuthoritative } =
        resolveConversationDisplayTotals(this.currentTotals);

      if (tokens > 0) {
        parts.push(
          t('agentLiveUsage.statusBar.tokens', {
            count: formatTokenCount(tokens),
          })
        );
      }

      if (costCents > 0) {
        parts.push(
          t('agentLiveUsage.statusBar.estimatedCost', {
            cost: formatCostUsd(costCents, costAuthoritative),
          })
        );
      } else if (tokens >= 100) {
        parts.push(
          t('agentLiveUsage.statusBar.estimatedCost', { cost: '<$0.01' })
        );
      }
    }

    this.item.text = `$(comment-discussion) ${parts.join(' · ')}`;
    this.item.tooltip = this.buildTooltip(id, this.currentTotals);
    this.item.backgroundColor =
      (this.currentTotals &&
        resolveConversationDisplayTotals(this.currentTotals).tokens > 0) ||
      contextPercent
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
    this.item.show();
  }

  private getContextPercentLabel(): string | undefined {
    const used = this.currentTotals?.latestContextUsedTokens;
    const max = this.currentTotals?.latestContextMaxTokens;
    if (used == null || max == null || max <= 0) {
      return undefined;
    }
    const label = formatContextPercent(used, max);
    return label || undefined;
  }

  private buildTooltip(
    conversationId: string,
    totals: ConversationTokenTotals | null
  ): string {
    const lines = [
      t('activeConversation.tooltip.title'),
      t('activeConversation.tooltip.lastFocused', { id: conversationId }),
    ];

    const selected = this.currentState?.selectedComposerIds ?? [];
    if (selected.length > 0) {
      lines.push(
        t('activeConversation.tooltip.selected', {
          ids: selected.join(', '),
        })
      );
    }

    if (
      totals?.latestContextUsedTokens != null &&
      totals.latestContextMaxTokens != null &&
      totals.latestContextMaxTokens > 0
    ) {
      lines.push('');
      lines.push(
        t('activeConversation.tooltip.context', {
          percent: formatContextPercent(
            totals.latestContextUsedTokens,
            totals.latestContextMaxTokens
          ),
          used: String(totals.latestContextUsedTokens),
          max: String(totals.latestContextMaxTokens),
        })
      );
    }

    if (totals) {
      const { tokens, costCents } = resolveConversationDisplayTotals(totals);
      lines.push('');
      lines.push(t('activeConversation.tooltip.tokens', { count: String(tokens) }));
      if (totals.totalDeltaTokens > 0) {
        lines.push(
          t('activeConversation.tooltip.liveDeltaTokens', {
            count: String(totals.totalDeltaTokens),
          })
        );
      }
      if (totals.totalTokens > 0) {
        lines.push(
          t('activeConversation.tooltip.billedTokens', {
            count: String(totals.totalTokens),
          })
        );
      }
      if (totals.totalInputTokens > 0 || totals.totalOutputTokens > 0) {
        lines.push(
          t('agentLiveUsage.statusBar.inOut', {
            input: formatTokenCount(totals.totalInputTokens),
            output: formatTokenCount(totals.totalOutputTokens),
          })
        );
      }
      if (costCents > 0) {
        lines.push(
          t('activeConversation.tooltip.estimatedCost', {
            cost: formatCostUsd(
              costCents,
              resolveConversationDisplayTotals(totals).costAuthoritative
            ),
          })
        );
      }
      if (totals.models.length > 0) {
        lines.push(
          t('activeConversation.tooltip.models', {
            models: totals.models.join(', '),
          })
        );
      }
    } else {
      lines.push('');
      lines.push(t('activeConversation.tooltip.noUsage'));
    }

    lines.push('');
    lines.push(t('activeConversation.tooltip.hint'));
    return lines.join('\n');
  }
}
