import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IngestTrafficResult } from '../../application/types/agentPersistence';
import {
  ProxyTrafficUsageCoordinator,
  type AgentTrafficIngestor,
  type ProxyTrafficUsageLogger,
} from '../../services/proxyTrafficUsageCoordinator';
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
  result: IngestTrafficResult
): AgentTrafficIngestor {
  return {
    ingestTraffic: async () => result,
  };
}

function logger(): ProxyTrafficUsageLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
  };
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
      logger: logger(),
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
      logger: logger(),
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
      logger: logger(),
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

  it('emits persisted usage for non-agent summaries returned by tracking', async () => {
    const events: Array<{ conversationId: string; profileId: string }> = [];
    const coordinator = new ProxyTrafficUsageCoordinator({
      isSharedProxyActive: () => false,
      ensureAgentTracking: async () => undefined,
      getAgentTrackingService: () =>
        tracking({
          conversationId: 'conversation-4',
          deltaPersisted: false,
          turnEndedPersisted: false,
          contextPersisted: true,
        }),
      onUsagePersisted: (event) => events.push(event),
      logger: logger(),
    });

    await coordinator.handle(traffic({ profileId: 'profile-4' }));

    assert.deepEqual(events, [
      { conversationId: 'conversation-4', profileId: 'profile-4' },
    ]);
  });

  it('warns and skips ingestion when agent traffic has no profile', async () => {
    const warnings: string[] = [];
    let ensured = false;
    const coordinator = new ProxyTrafficUsageCoordinator({
      isSharedProxyActive: () => false,
      ensureAgentTracking: async () => {
        ensured = true;
      },
      getAgentTrackingService: () => undefined,
      onUsagePersisted: () => undefined,
      logger: {
        info: () => undefined,
        warn: (message) => warnings.push(message),
      },
    });

    const profileId = await coordinator.handle(
      traffic({ isLiveTokenUpdate: true })
    );

    assert.equal(profileId, undefined);
    assert.equal(ensured, false);
    assert.deepEqual(warnings, [
      '[AgentTracking] agent traffic without profileId — ingest skipped',
    ]);
  });

  it('uses context conversation metadata for shared live usage', async () => {
    const events: Array<{ conversationId: string; profileId: string }> = [];
    const coordinator = new ProxyTrafficUsageCoordinator({
      isSharedProxyActive: () => true,
      ensureAgentTracking: async () => undefined,
      getAgentTrackingService: () => undefined,
      onUsagePersisted: (event) => events.push(event),
      logger: logger(),
    });

    await coordinator.handle(
      traffic({
        profileId: 'profile-5',
        isLiveTokenUpdate: true,
        insights: { context: { conversationId: 'conversation-5' } },
      })
    );

    assert.deepEqual(events, [
      { conversationId: 'conversation-5', profileId: 'profile-5' },
    ]);
  });
});
