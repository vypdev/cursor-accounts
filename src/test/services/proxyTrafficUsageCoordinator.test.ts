import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgentTrackingService } from '../../services/agentTrackingService';
import { ProxyTrafficUsageCoordinator } from '../../services/proxyTrafficUsageCoordinator';
import { SHARED_PROXY_RUNTIME_KEY } from '../../proxy/types';
import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';

function traffic(
  overrides: Partial<ProxyTrafficSummary> = {}
): ProxyTrafficSummary {
  return {
    timestamp: new Date().toISOString(),
    kind: 'response',
    url: 'https://api2.cursor.sh/agent',
    host: 'api2.cursor.sh',
    endpoint: '/agent',
    ...overrides,
  };
}

function tracking(
  result: {
    conversationId: string;
    deltaPersisted: boolean;
    turnEndedPersisted: boolean;
    contextPersisted: boolean;
  }
): AgentTrackingService {
  return {
    ingestTraffic: async () => result,
  } as unknown as AgentTrackingService;
}

describe('ProxyTrafficUsageCoordinator', () => {
  it('ingests per-profile agent traffic and emits persisted usage', async () => {
    const events: Array<{ conversationId: string; profileId: string }> = [];
    const service = tracking({
      conversationId: 'conversation-1',
      deltaPersisted: true,
      turnEndedPersisted: false,
      contextPersisted: false,
    });
    let ensuredProfile: string | undefined;
    const coordinator = new ProxyTrafficUsageCoordinator({
      isSharedProxyActive: () => false,
      ensureAgentTracking: async (profileId) => {
        ensuredProfile = profileId;
      },
      getAgentTrackingService: () => service,
      onUsagePersisted: (event) => events.push(event),
    });

    const profileId = await coordinator.handle(
      traffic({
        isLiveTokenUpdate: true,
        profileId: 'profile-1',
        insights: {
          agent: { requestId: 'request-1', usageEvent: 'token_details' },
        },
      }),
      'fallback-profile'
    );

    assert.equal(profileId, 'profile-1');
    assert.equal(ensuredProfile, 'profile-1');
    assert.deepEqual(events, [
      { conversationId: 'conversation-1', profileId: 'profile-1' },
    ]);
  });

  it('notifies shared-mode usage without ingesting it locally', async () => {
    let ensured = false;
    let ingested = false;
    const events: Array<{ conversationId: string; profileId: string }> = [];
    const coordinator = new ProxyTrafficUsageCoordinator({
      isSharedProxyActive: () => true,
      ensureAgentTracking: async () => {
        ensured = true;
      },
      getAgentTrackingService: () => {
        ingested = true;
        return tracking({
          conversationId: 'unused',
          deltaPersisted: true,
          turnEndedPersisted: false,
          contextPersisted: false,
        });
      },
      onUsagePersisted: (event) => events.push(event),
    });

    await coordinator.handle(
      traffic({
        profileId: 'profile-1',
        isTurnEnded: true,
        insights: {
          agent: { conversationId: 'conversation-2' },
        },
      })
    );

    assert.equal(ensured, false);
    assert.equal(ingested, false);
    assert.deepEqual(events, [
      { conversationId: 'conversation-2', profileId: 'profile-1' },
    ]);
  });

  it('does not ingest shared runtime traffic as a profile', async () => {
    let ensured = false;
    const events: Array<{ conversationId: string; profileId: string }> = [];
    const coordinator = new ProxyTrafficUsageCoordinator({
      isSharedProxyActive: () => false,
      ensureAgentTracking: async () => {
        ensured = true;
      },
      getAgentTrackingService: () => undefined,
      onUsagePersisted: (event) => events.push(event),
    });

    const profileId = await coordinator.handle(
      traffic({
        profileId: SHARED_PROXY_RUNTIME_KEY,
        isLiveTokenUpdate: true,
        insights: { agent: { conversationId: 'conversation-3' } },
      })
    );

    assert.equal(profileId, SHARED_PROXY_RUNTIME_KEY);
    assert.equal(ensured, false);
    assert.deepEqual(events, []);
  });
});
