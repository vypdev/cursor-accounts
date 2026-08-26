import {
  getBilledTokenTotal,
  type AgentLiveUsageSessionState,
} from '../../application/services/agentLiveUsageState';
import { t } from '../../l10n';

export type AgentLiveUsageDisplay =
  | { visible: false }
  | { visible: true; text: string; tooltip: string };

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}m`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(Math.round(count));
}

function formatCostUsd(costCents: number, authoritative: boolean): string {
  const costUsd = costCents / 100;
  if (costUsd < 0.01) {
    return '<$0.01';
  }
  const label = `$${costUsd.toFixed(2)}`;
  return authoritative ? label : `~${label}`;
}

/** Builds the user-visible live-usage content without depending on VS Code. */
export function buildAgentLiveUsageDisplay(
  sessions: ReadonlyMap<string, AgentLiveUsageSessionState>,
  enabled: boolean
): AgentLiveUsageDisplay {
  if (!enabled || sessions.size === 0) {
    return { visible: false };
  }

  const totals = summarizeSessions(sessions);
  const total =
    totals.billedTokens > 0
      ? totals.billedTokens
      : totals.streamingTokens;
  if (total <= 0 && totals.liveCostCents <= 0 && !totals.hasTurnCost) {
    return { visible: false };
  }

  const parts: string[] = [];
  if (total > 0) {
    parts.push(formatTokenCount(total));
  }

  const displayCostCents = totals.hasTurnCost
    ? totals.turnCostCents
    : totals.liveCostCents;
  const costAuthoritative =
    totals.hasTurnCost && totals.hasAuthoritativeTurnCost;

  if (displayCostCents > 0 || totals.hasTurnCost) {
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

  return {
    visible: true,
    text: `$(symbol-event) ${parts.join(' · ')}`,
    tooltip: buildTooltip(
      sessions,
      total,
      totals.hasTurnCost || displayCostCents > 0
        ? displayCostCents / 100
        : undefined,
      costAuthoritative
    ),
  };
}

interface SessionTotals {
  streamingTokens: number;
  billedTokens: number;
  liveCostCents: number;
  turnCostCents: number;
  hasAuthoritativeTurnCost: boolean;
  hasTurnCost: boolean;
}

function summarizeSessions(
  sessions: ReadonlyMap<string, AgentLiveUsageSessionState>
): SessionTotals {
  const totals: SessionTotals = {
    streamingTokens: 0,
    billedTokens: 0,
    liveCostCents: 0,
    turnCostCents: 0,
    hasAuthoritativeTurnCost: false,
    hasTurnCost: false,
  };

  for (const session of sessions.values()) {
    const sessionLive = session.liveAccumulated;
    const sessionBilled = session.billedTokens;
    totals.streamingTokens += sessionLive > 0 ? sessionLive : sessionBilled;
    totals.billedTokens +=
      sessionBilled > 0 ? sessionBilled : getBilledTokenTotal(session.agent);

    if (session.turnTotalCents != null) {
      totals.hasTurnCost = true;
      totals.turnCostCents += session.turnTotalCents;
      totals.hasAuthoritativeTurnCost ||= session.turnCostFromServer === true;
    } else {
      totals.liveCostCents += session.liveAccumulatedCostCents;
    }
  }

  return totals;
}

function buildTooltip(
  sessions: ReadonlyMap<string, AgentLiveUsageSessionState>,
  total: number,
  costUsd: number | undefined,
  costAuthoritative: boolean
): string {
  const lines = [
    t('agentLiveUsage.tooltip.title'),
    t('agentLiveUsage.tooltip.total', { count: String(total) }),
  ];

  if (sessions.size > 1) {
    lines.push(`Active sessions: ${sessions.size}`);
  }

  for (const [sessionId, session] of sessions.entries()) {
    const sessionTotal =
      session.liveAccumulated > 0
        ? session.liveAccumulated
        : session.billedTokens;

    lines.push('');
    lines.push(
      `Session ${sessionId.slice(0, 8)}: ${sessionTotal} tokens (live: ${session.liveAccumulated}, billed: ${session.billedTokens})`
    );

    if (session.modelId) {
      lines.push(`  Model: ${session.modelId}`);
    }

    if (session.liveAccumulatedCostCents > 0) {
      lines.push(
        `  Live cost: ${formatCostUsd(session.liveAccumulatedCostCents, false)}`
      );
    }

    if (session.turnTotalCents != null) {
      lines.push(
        `  Turn cost: ${formatCostUsd(
          session.turnTotalCents,
          session.turnCostFromServer === true
        )}`
      );
    }

    if (session.agent.inputTokens != null || session.agent.outputTokens != null) {
      lines.push(
        `  ${t('agentLiveUsage.tooltip.turn', {
          input: String(session.agent.inputTokens ?? 0),
          output: String(session.agent.outputTokens ?? 0),
        })}`
      );
    }

    if (
      session.agent.cacheReadTokens != null ||
      session.agent.cacheWriteTokens != null
    ) {
      lines.push(
        `  ${t('agentLiveUsage.tooltip.cache', {
          read: String(session.agent.cacheReadTokens ?? 0),
          write: String(session.agent.cacheWriteTokens ?? 0),
        })}`
      );
    }

    if (session.agent.usageUuid) {
      lines.push(
        `  ${t('agentLiveUsage.tooltip.usageUuid', {
          id: session.agent.usageUuid,
        })}`
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
