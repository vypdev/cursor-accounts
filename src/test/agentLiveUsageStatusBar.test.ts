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
});
