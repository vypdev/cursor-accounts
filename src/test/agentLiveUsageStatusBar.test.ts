import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProxyTrafficSummary } from '../proxy/types';
import { AgentLiveUsageStatusBar } from '../ui/agentLiveUsageStatusBar';

function createContext() {
  return {
    extensionPath: '/tmp/extension',
    subscriptions: [] as { dispose(): void }[],
  } as never;
}

function baseSummary(
  overrides: Partial<ProxyTrafficSummary> = {}
): ProxyTrafficSummary {
  return {
    timestamp: new Date().toISOString(),
    kind: 'response',
    url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
    host: 'agent.api5.cursor.sh',
    endpoint: '/agent.v1.AgentService/RunSSE',
    ...overrides,
  };
}

describe('AgentLiveUsageStatusBar', () => {
  it('ignores batch turn_ended after IPC turn_ended for the same session', () => {
    const statusBar = new AgentLiveUsageStatusBar(createContext());
    const requestId = 'req-ipc-priority';

    statusBar.ingest(
      baseSummary({
        isTurnEnded: true,
        insights: {
          agent: {
            requestId,
            inputTokens: 1200,
            outputTokens: 300,
            usageEvent: 'turn_ended',
          },
        },
      })
    );

    statusBar.ingest(
      baseSummary({
        insights: {
          agent: {
            requestId,
            inputTokens: 314_202_530_873_276,
            outputTokens: 200,
            usageEvent: 'turn_ended',
          },
        },
      })
    );

    const sessions = (
      statusBar as unknown as {
        sessions: Map<
          string,
          {
            agent: { inputTokens?: number; outputTokens?: number };
            billedTokens: number;
            turnEndedFromIpc?: boolean;
          }
        >;
      }
    ).sessions;

    const session = sessions.get(requestId);
    assert.equal(session?.agent.inputTokens, 1200);
    assert.equal(session?.agent.outputTokens, 300);
    assert.equal(session?.billedTokens, 1500);
    assert.equal(session?.turnEndedFromIpc, true);
  });

  it('accumulates live cost incrementally from deltaCostCents', () => {
    const statusBar = new AgentLiveUsageStatusBar(createContext());
    const requestId = 'req-live-cost';

    statusBar.ingest(
      baseSummary({
        isLiveTokenUpdate: true,
        liveTokenData: {
          accumulatedTokens: 100,
          latestDelta: 100,
          deltaCostCents: 0.15,
          modelId: 'composer-2.5',
        },
        insights: { agent: { requestId } },
      })
    );

    statusBar.ingest(
      baseSummary({
        isLiveTokenUpdate: true,
        liveTokenData: {
          accumulatedTokens: 250,
          latestDelta: 150,
          deltaCostCents: 0.225,
          modelId: 'composer-2.5',
        },
        insights: { agent: { requestId } },
      })
    );

    const sessions = (
      statusBar as unknown as {
        sessions: Map<
          string,
          { liveAccumulatedCostCents: number; liveAccumulated: number }
        >;
      }
    ).sessions;

    const session = sessions.get(requestId);
    assert.ok(Math.abs((session?.liveAccumulatedCostCents ?? 0) - 0.375) < 0.01);
    assert.equal(session?.liveAccumulated, 250);
  });

  it('uses server totalCents on turn_ended when provided', () => {
    const statusBar = new AgentLiveUsageStatusBar(createContext());
    const requestId = 'req-turn-cost';

    statusBar.ingest(
      baseSummary({
        isTurnEnded: true,
        insights: {
          agent: {
            requestId,
            inputTokens: 1000,
            outputTokens: 500,
            totalCents: 80,
            usageEvent: 'turn_ended',
            requestedModelId: 'composer-2.5',
          },
          tokens: {
            promptTokens: 1000,
            completionTokens: 500,
            totalCents: 80,
          },
        },
      })
    );

    const sessions = (
      statusBar as unknown as {
        sessions: Map<
          string,
          {
            turnTotalCents?: number;
            turnCostFromServer?: boolean;
            liveAccumulatedCostCents: number;
          }
        >;
      }
    ).sessions;

    const session = sessions.get(requestId);
    assert.equal(session?.turnTotalCents, 80);
    assert.equal(session?.turnCostFromServer, true);
    assert.equal(session?.liveAccumulatedCostCents, 0);
  });
});
