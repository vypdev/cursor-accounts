import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';
import { ProxyTrafficSessionCoordinator } from '../../proxy/proxyTrafficSessionCoordinator';

function summary(overrides: Partial<ProxyTrafficSummary> = {}): ProxyTrafficSummary {
  return {
    timestamp: '2024-01-01T00:00:00.000Z',
    kind: 'response',
    url: 'https://api2.cursor.sh/agent.v1.AgentService/RunSSE',
    host: 'api2.cursor.sh',
    endpoint: '/agent.v1.AgentService/RunSSE',
    ...overrides,
  };
}

describe('ProxyTrafficSessionCoordinator', () => {
  it('tracks model and conversation identifiers for stream correlation', () => {
    const coordinator = new ProxyTrafficSessionCoordinator({
      onTraffic: () => undefined,
    });

    coordinator.track(
      summary({
        insights: {
          agent: {
            requestId: 'bidi-1',
            requestedModelId: 'model-1',
            conversationId: 'conversation-1',
          },
        },
      })
    );

    assert.equal(coordinator.resolveModelId('bidi-1'), 'model-1');
    assert.equal(
      coordinator.resolveConversationId('bidi-1'),
      'conversation-1'
    );
  });

  it('enriches agent summaries with session profile and workspace context', () => {
    const received: ProxyTrafficSummary[] = [];
    const coordinator = new ProxyTrafficSessionCoordinator({
      onTraffic: (event) => received.push(event),
    });

    coordinator.dispatch(
      summary({
        profileId: 'profile-1',
        insights: { agent: { requestId: 'bidi-1' } },
      })
    );
    coordinator.dispatch(
      summary({
        insights: {
          agent: { requestId: 'bidi-1' },
          workspace: { workspaceId: 'workspace-1' },
        },
      })
    );

    assert.equal(received.length, 2);
    assert.equal(received[1]?.profileId, 'profile-1');
    assert.equal(received[1]?.workspaceId, 'workspace-1');
  });

  it('preserves summaries without agent context unchanged', () => {
    const received: ProxyTrafficSummary[] = [];
    const event = summary({ workspaceId: 'workspace-1' });
    const coordinator = new ProxyTrafficSessionCoordinator({
      onTraffic: (receivedEvent) => received.push(receivedEvent),
    });

    coordinator.dispatch(event);

    assert.deepEqual(received, [event]);
  });

  it('clears session state when the proxy stops', () => {
    const coordinator = new ProxyTrafficSessionCoordinator({
      onTraffic: () => undefined,
    });
    coordinator.track(
      summary({
        insights: {
          agent: {
            requestId: 'bidi-1',
            requestedModelId: 'model-1',
          },
        },
      })
    );

    coordinator.clear();

    assert.equal(coordinator.resolveModelId('bidi-1'), undefined);
    assert.equal(coordinator.resolveConversationId('bidi-1'), undefined);
  });
});
