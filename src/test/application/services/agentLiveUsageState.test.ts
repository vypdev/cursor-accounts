import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AgentLiveUsageState,
  type AgentSessionMerger,
} from '../../../application/services/agentLiveUsageState';
import type { ProxyTrafficSummary } from '../../../domain/types/proxyTraffic';

const mergeAgentSessionInfo: AgentSessionMerger = (base, extra) => {
  if (!base && !extra) {
    return undefined;
  }
  const merged = { ...(base ?? {}), ...(extra ?? {}) };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) {
      delete (merged as Record<string, unknown>)[key];
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
};

function baseSummary(
  overrides: Partial<ProxyTrafficSummary> = {}
): ProxyTrafficSummary {
  return {
    timestamp: '2026-08-26T00:00:00.000Z',
    kind: 'response',
    url: 'https://api2.cursor.sh/agent.v1.AgentService/RunSSE',
    host: 'api2.cursor.sh',
    endpoint: '/agent.v1.AgentService/RunSSE',
    ...overrides,
  };
}

function createState(overrides: {
  deltaCost?: number;
  turnCost?: number;
  now?: number;
} = {}) {
  const calls = { delta: 0, turn: 0 };
  const state = new AgentLiveUsageState({
    mergeAgentSessionInfo,
    costCalculator: {
      calculateDeltaCost: () => {
        calls.delta += 1;
        return overrides.deltaCost ?? 0.25;
      },
      calculateTurnCost: () => {
        calls.turn += 1;
        return overrides.turnCost ?? 1.5;
      },
    },
    now: () => overrides.now ?? 123,
  });
  return { state, calls };
}

describe('AgentLiveUsageState', () => {
  it('ignores traffic without usage information', () => {
    const { state } = createState();

    assert.equal(state.ingest(baseSummary()), false);
    assert.equal(state.sessions.size, 0);
    assert.equal(state.activeSessionId, undefined);
  });

  it('tracks synthetic live usage and delegates missing delta cost to the domain calculator', () => {
    const { state, calls } = createState({ deltaCost: 0.375 });

    assert.equal(
      state.ingest(
        baseSummary({
          isLiveTokenUpdate: true,
          liveTokenData: {
            accumulatedTokens: 250,
            latestDelta: 250,
            modelId: 'composer-2.5',
          },
        })
      ),
      true
    );

    const session = state.sessions.get('active');
    assert.equal(calls.delta, 1);
    assert.equal(session?.liveAccumulated, 250);
    assert.equal(session?.liveAccumulatedCostCents, 0.375);
    assert.equal(session?.modelId, 'composer-2.5');
    assert.equal(session?.lastActivity, 123);
  });

  it('prioritizes a valid server cost and resets live totals at turn end', () => {
    const { state, calls } = createState({ turnCost: 99 });
    const requestId = 'request-server-cost';

    state.ingest(
      baseSummary({
        isLiveTokenUpdate: true,
        liveTokenData: {
          accumulatedTokens: 100,
          latestDelta: 100,
          deltaCostCents: 0.1,
        },
        insights: { agent: { requestId } },
      })
    );
    state.ingest(
      baseSummary({
        isTurnEnded: true,
        insights: {
          agent: {
            requestId,
            inputTokens: 100,
            outputTokens: 50,
            usageEvent: 'turn_ended',
          },
          tokens: {
            promptTokens: 100,
            completionTokens: 50,
            totalCents: 2.5,
          },
        },
      })
    );

    const session = state.sessions.get(requestId);
    assert.equal(calls.turn, 0);
    assert.equal(session?.turnTotalCents, 2.5);
    assert.equal(session?.turnCostFromServer, true);
    assert.equal(session?.liveAccumulated, 0);
    assert.equal(session?.liveAccumulatedCostCents, 0);
    assert.equal(session?.billedTokens, 150);
  });

  it('uses the domain turn calculator when server cost is absent', () => {
    const { state, calls } = createState({ turnCost: 3.25 });

    state.ingest(
      baseSummary({
        isTurnEnded: true,
        insights: {
          agent: {
            requestId: 'request-calculated-cost',
            inputTokens: 1000,
            outputTokens: 500,
            usageEvent: 'turn_ended',
          },
        },
      })
    );

    const session = state.sessions.get('request-calculated-cost');
    assert.equal(calls.turn, 1);
    assert.equal(session?.turnTotalCents, 3.25);
    assert.equal(session?.turnCostFromServer, false);
  });

  it('ignores a later batch turn-ended event after a live turn-ended event', () => {
    const { state } = createState();
    const requestId = 'request-live-end';

    state.ingest(
      baseSummary({
        isLiveTokenUpdate: true,
        isTurnEnded: true,
        liveTokenData: {
          accumulatedTokens: 200,
          latestDelta: 200,
        },
        insights: { agent: { requestId } },
      })
    );
    const before = state.sessions.get(requestId);
    const accepted = state.ingest(
      baseSummary({
        insights: {
          agent: {
            requestId,
            inputTokens: 999_999,
            outputTokens: 1,
            usageEvent: 'turn_ended',
          },
        },
      })
    );

    assert.equal(accepted, false);
    assert.deepEqual(state.sessions.get(requestId), before);
  });
});
