import type { ConversationTokenTotals } from '../../application/types/agentPersistence';
import type { ActiveConversationState } from '../../application/types/activeConversation';
import { t } from '../../l10n';

export interface ActiveConversationStatusBarDisplay {
  text: string;
  tooltip: string;
  showWarning: boolean;
}

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

/** Builds the user-visible active-conversation status without depending on VS Code. */
export function buildActiveConversationStatusBarDisplay(
  state: ActiveConversationState | null,
  totals: ConversationTokenTotals | null
): ActiveConversationStatusBarDisplay {
  const conversationId = state?.lastFocusedComposerId;
  if (!conversationId) {
    return {
      text: `$(comment-discussion) ${t('activeConversation.statusBar.none')}`,
      tooltip: t('activeConversation.tooltip.none'),
      showWarning: false,
    };
  }

  const parts: string[] = [conversationId.slice(0, 8)];
  const contextPercent = getContextPercentLabel(totals);
  if (contextPercent) {
    parts.push(contextPercent);
  }

  if (totals) {
    const { tokens, costCents, costAuthoritative } =
      resolveConversationDisplayTotals(totals);

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

  return {
    text: `$(comment-discussion) ${parts.join(' · ')}`,
    tooltip: buildTooltip(state, conversationId, totals),
    showWarning:
      (totals && resolveConversationDisplayTotals(totals).tokens > 0) ||
      Boolean(contextPercent),
  };
}

function getContextPercentLabel(
  totals: ConversationTokenTotals | null
): string | undefined {
  const used = totals?.latestContextUsedTokens;
  const max = totals?.latestContextMaxTokens;
  if (used == null || max == null || max <= 0) {
    return undefined;
  }
  const label = formatContextPercent(used, max);
  return label || undefined;
}

function buildTooltip(
  state: ActiveConversationState,
  conversationId: string,
  totals: ConversationTokenTotals | null
): string {
  const lines = [
    t('activeConversation.tooltip.title'),
    t('activeConversation.tooltip.lastFocused', { id: conversationId }),
  ];

  const selected = state.selectedComposerIds;
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
    const { tokens, costCents, costAuthoritative } =
      resolveConversationDisplayTotals(totals);
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
          cost: formatCostUsd(costCents, costAuthoritative),
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
