import type { ConversationTokenTotals } from '../../application/types/agentPersistence';
import type { ActiveConversationState } from '../../application/types/activeConversation';
import { t } from '../../l10n';
import { formatCostUsd, formatTokenCount } from './tokenCostFormatting';

export interface ActiveConversationStatusBarDisplay {
  text: string;
  tooltip: string;
  showWarning: boolean;
}

export function formatContextPercent(used: number, max: number): string {
  if (max <= 0) {
    return '';
  }
  const pct = Math.max(0, Math.min(100, Math.round((used / max) * 1000) / 10));
  return pct % 1 === 0 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
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

  const parts = buildDisplayParts(conversationId, totals);

  return {
    text: `$(comment-discussion) ${parts.text}`,
    tooltip: buildTooltip(state, conversationId, totals),
    showWarning: parts.showWarning,
  };
}

interface ActiveConversationDisplayParts {
  text: string;
  showWarning: boolean;
}

function buildDisplayParts(
  conversationId: string,
  totals: ConversationTokenTotals | null
): ActiveConversationDisplayParts {
  const parts: string[] = [conversationId.slice(0, 8)];
  const contextPercent = getContextPercentLabel(totals);
  if (contextPercent) {
    parts.push(contextPercent);
  }
  if (totals) {
    appendUsageParts(parts, totals);
  }

  return {
    text: parts.join(' · '),
    showWarning:
      Boolean(contextPercent) ||
      (totals != null && resolveConversationDisplayTotals(totals).tokens > 0),
  };
}

function appendUsageParts(
  parts: string[],
  totals: ConversationTokenTotals
): void {
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

  appendSelectedComposerTooltip(lines, state);
  appendContextTooltip(lines, totals);
  appendUsageTooltip(lines, totals);

  lines.push('');
  lines.push(t('activeConversation.tooltip.hint'));
  return lines.join('\n');
}

function appendSelectedComposerTooltip(
  lines: string[],
  state: ActiveConversationState
): void {
  const selected = state.selectedComposerIds;
  if (selected.length === 0) {
    return;
  }
  lines.push(
    t('activeConversation.tooltip.selected', {
      ids: selected.join(', '),
    })
  );
}

function appendContextTooltip(
  lines: string[],
  totals: ConversationTokenTotals | null
): void {
  const used = totals?.latestContextUsedTokens;
  const max = totals?.latestContextMaxTokens;
  if (used == null || max == null || max <= 0) {
    return;
  }
  lines.push('');
  lines.push(
    t('activeConversation.tooltip.context', {
      percent: formatContextPercent(used, max),
      used: String(used),
      max: String(max),
    })
  );
}

function appendUsageTooltip(
  lines: string[],
  totals: ConversationTokenTotals | null
): void {
  lines.push('');
  if (!totals) {
    lines.push(t('activeConversation.tooltip.noUsage'));
    return;
  }

  appendTokenTooltip(lines, totals);
  appendCostTooltip(lines, totals);
  appendModelsTooltip(lines, totals);
}

function appendTokenTooltip(
  lines: string[],
  totals: ConversationTokenTotals
): void {
  const { tokens } = resolveConversationDisplayTotals(totals);
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
}

function appendCostTooltip(
  lines: string[],
  totals: ConversationTokenTotals
): void {
  const { costCents, costAuthoritative } =
    resolveConversationDisplayTotals(totals);
  if (costCents <= 0) {
    return;
  }
  lines.push(
    t('activeConversation.tooltip.estimatedCost', {
      cost: formatCostUsd(costCents, costAuthoritative),
    })
  );
}

function appendModelsTooltip(
  lines: string[],
  totals: ConversationTokenTotals
): void {
  if (totals.models.length === 0) {
    return;
  }
  lines.push(
    t('activeConversation.tooltip.models', {
      models: totals.models.join(', '),
    })
  );
}
