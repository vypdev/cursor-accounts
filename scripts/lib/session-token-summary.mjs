/**
 * Session-level token and cost accounting for proxy captures.
 *
 * The module keeps state transitions and report calculations independent from
 * protobuf loading, filesystem access, and CLI rendering.
 */

export const DEFAULT_DOLLARS_PER_M = 4;

/**
 * @typedef {{ input: number, output: number, cacheRead: number, cacheWrite: number }} TurnEndedTotals
 * @typedef {{ ts?: string, total: unknown, included: unknown, bonus: unknown, limit: unknown }} BillingSnapshot
 * @typedef {{ billingSnapshots: BillingSnapshot[], tokenPeaks: Array<{ ts?: string, seqno: number, tokens: unknown }>, turnEndedCount: number, tokenDetailsCount: number, turnEndedTotals: TurnEndedTotals, requestIds: Set<string>, firstTs: string | null, lastTs: string | null }} SessionSummaryState
 */

/**
 * @returns {SessionSummaryState}
 */
export function createSessionSummaryState() {
  return {
    billingSnapshots: [],
    tokenPeaks: [],
    turnEndedCount: 0,
    tokenDetailsCount: 0,
    turnEndedTotals: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    requestIds: new Set(),
    firstTs: null,
    lastTs: null,
  };
}

/**
 * @param {unknown} cents
 */
export function centsToUsd(cents) {
  return (Number(cents) / 100).toFixed(2);
}

/**
 * @param {unknown} planUsage
 * @returns {{ total: unknown, included: unknown, bonus: unknown, limit: unknown } | null}
 */
export function planSpend(planUsage) {
  if (!planUsage || typeof planUsage !== 'object') {
    return null;
  }
  const usage = /** @type {Record<string, unknown>} */ (planUsage);
  return {
    total: usage.totalSpend ?? usage.total_spend,
    included: usage.includedSpend ?? usage.included_spend,
    bonus: usage.bonusSpend ?? usage.bonus_spend,
    limit: usage.limit,
  };
}

/**
 * @param {Array<{ seqno?: number, tokens: unknown }>} peaks
 */
export function groupMajorTurnPeaks(peaks) {
  const sorted = [...peaks].sort((a, b) => (a.seqno ?? 0) - (b.seqno ?? 0));
  const turns = [];
  let current = { max: 0, count: 0 };

  for (const peak of sorted) {
    if (
      current.count > 0 &&
      current.max >= 300 &&
      Number(peak.tokens) <= 150
    ) {
      turns.push({ max: current.max, count: current.count });
      current = { max: 0, count: 0 };
    }
    current.count += 1;
    if (Number(peak.tokens) > current.max) {
      current.max = Number(peak.tokens);
    }
  }

  if (current.count > 0) {
    turns.push({ max: current.max, count: current.count });
  }
  return turns;
}

/**
 * @param {SessionSummaryState} state
 * @param {unknown} timestamp
 */
export function recordSessionTimestamp(state, timestamp) {
  if (typeof timestamp !== 'string' || timestamp.length === 0) {
    return;
  }
  if (!state.firstTs || timestamp < state.firstTs) {
    state.firstTs = timestamp;
  }
  if (!state.lastTs || timestamp > state.lastTs) {
    state.lastTs = timestamp;
  }
}

/**
 * @param {SessionSummaryState} state
 * @param {unknown} requestId
 */
export function recordRequestId(state, requestId) {
  if (typeof requestId === 'string' && requestId.length > 0) {
    state.requestIds.add(requestId);
  }
}

/**
 * @param {SessionSummaryState} state
 * @param {string | undefined} timestamp
 * @param {{ total: unknown, included: unknown, bonus: unknown, limit: unknown }} spend
 */
export function recordBillingSnapshot(state, timestamp, spend) {
  if (spend.total != null) {
    state.billingSnapshots.push({ ts: timestamp, ...spend });
  }
}

/**
 * @param {unknown} insight
 * @param {string | undefined} timestamp
 * @param {SessionSummaryState} state
 */
export function recordAgentInsight(insight, timestamp, state) {
  if (!insight || typeof insight !== 'object') {
    return;
  }
  const agent = /** @type {Record<string, any>} */ (insight);
  if (agent.usageEvent === 'turn_ended') {
    state.turnEndedCount += 1;
    state.turnEndedTotals.input += Number(agent.inputTokens) || 0;
    state.turnEndedTotals.output += Number(agent.outputTokens) || 0;
    state.turnEndedTotals.cacheRead += Number(agent.cacheReadTokens) || 0;
    state.turnEndedTotals.cacheWrite += Number(agent.cacheWriteTokens) || 0;
    return;
  }
  if (agent.usageEvent === 'token_delta' && agent.streamingTokens != null) {
    state.tokenPeaks.push({
      ts: timestamp,
      seqno: state.tokenPeaks.length,
      tokens: agent.streamingTokens,
    });
    return;
  }
  if (agent.usageEvent === 'token_details') {
    state.tokenDetailsCount += 1;
  }
}

/**
 * @param {string} file
 * @param {SessionSummaryState} state
 * @param {number} dollarsPerM
 */
export function buildSessionReport(
  file,
  state,
  dollarsPerM = DEFAULT_DOLLARS_PER_M
) {
  const majorTurns = groupMajorTurnPeaks(state.tokenPeaks);
  const maxSinglePeak = state.tokenPeaks.reduce(
    (max, peak) => Math.max(max, Number(peak.tokens) || 0),
    0
  );
  const sumMajorTurnPeaks = majorTurns.reduce((sum, turn) => sum + turn.max, 0);
  const billing = [...state.billingSnapshots].sort((a, b) =>
    (a.ts ?? '').localeCompare(b.ts ?? '')
  );
  const first = billing[0];
  const last = billing.at(-1);
  const deltaCents =
    first && last ? Number(last.total) - Number(first.total) : null;

  return {
    file,
    window: { firstTs: state.firstTs, lastTs: state.lastTs },
    agentSessions: state.requestIds.size,
    requestIds: [...state.requestIds],
    tokenDeltaEvents: state.tokenPeaks.length,
    maxSinglePeak,
    majorTurns,
    sumMajorTurnPeaks,
    naiveEstUsd: (sumMajorTurnPeaks / 1e6) * dollarsPerM,
    turnEndedCount: state.turnEndedCount,
    turnEndedTotals: state.turnEndedTotals,
    billing: {
      samples: billing.length,
      first,
      last,
      deltaCents,
      deltaUsd: deltaCents != null ? centsToUsd(deltaCents) : null,
    },
    dollarsPerM,
  };
}
