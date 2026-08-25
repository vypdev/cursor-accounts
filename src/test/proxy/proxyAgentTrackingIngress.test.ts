import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IAgentTrackingDbPool } from '../../domain/ports/IAgentTrackingDbPool';
import type { IAgentTrackingRepository } from '../../domain/ports/IAgentTrackingRepository';
import { ProxyAgentTrackingIngress } from '../../proxy/proxyAgentTrackingIngress';
import type { ProxyTrafficSummary } from '../../proxy/types';

function summary(
  profileId: string,
  requestId: string,
  streamingTokens: number
): ProxyTrafficSummary {
  return {
    timestamp: new Date().toISOString(),
    kind: 'response',
    url: 'https://agent.cursor.sh/BidiAppend',
    host: 'agent.cursor.sh',
    endpoint: '/BidiAppend',
    profileId,
    insights: {
      agent: {
        requestId,
        conversationId: `conversation-${profileId}`,
        streamingTokens,
        usageEvent: 'token_delta',
      },
    },
  };
}

function createRepository(
  profileId: string,
  calls: string[]
): IAgentTrackingRepository {
  return {
    initialize: async () => {
      calls.push(`${profileId}:initialize`);
    },
    upsertConversation: async () => {
      calls.push(`${profileId}:conversation`);
    },
    upsertAgent: async (agent) => {
      calls.push(`${profileId}:agent:${agent.requestId}`);
    },
    insertTokenSnapshot: async () => undefined,
    upsertTokenDelta: async (delta) => {
      calls.push(`${profileId}:delta:${delta.requestId}`);
    },
    insertTurnEnded: async () => undefined,
    getTotalConversationTokens: async () => ({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalTokens: 0,
      totalDeltaTokens: 0,
      totalDeltaCostCents: 0,
      totalTurnCostCents: 0,
      deltaMinuteBuckets: 0,
      agentCount: 0,
      models: [],
      startedAt: 0,
      endedAt: 0,
    }),
    getTotalDeltaTokensByConversation: async () => ({
      totalStreamingTokens: 0,
      totalCostCents: 0,
      minuteBuckets: 0,
    }),
    getTurnEndedByConversation: async () => [],
    getAgentTokens: async () => null,
    getAgentTree: async () => [],
    getDatabaseSize: async () => 0,
    deleteOldConversations: async () => 0,
  };
}

function createPool(
  repositories: Map<string, IAgentTrackingRepository>,
  closeCalls: string[]
): IAgentTrackingDbPool {
  return {
    getRepositoryForProfile: async (profileId) => {
      const repository = repositories.get(profileId);
      if (!repository) {
        throw new Error(`Missing repository for ${profileId}`);
      }
      return repository;
    },
    closeAll: async () => {
      closeCalls.push('closeAll');
    },
    closeProfile: async () => undefined,
  };
}

describe('ProxyAgentTrackingIngress', () => {
  it('serializes events within a profile and preserves enqueue order', async () => {
    const calls: string[] = [];
    const repositories = new Map([
      ['profile-a', createRepository('profile-a', calls)],
    ]);
    const ingress = new ProxyAgentTrackingIngress(
      createPool(repositories, []),
      'profile-a'
    );

    await Promise.all([
      ingress.enqueue(summary('profile-a', 'request-1', 10)),
      ingress.enqueue(summary('profile-a', 'request-2', 20)),
      ingress.enqueue(summary('profile-a', 'request-3', 30)),
    ]);

    assert.deepEqual(
      calls.filter((call) => call.includes(':agent:')),
      [
        'profile-a:agent:request-1',
        'profile-a:agent:request-2',
        'profile-a:agent:request-3',
      ]
    );
  });

  it('allows different profiles to use independent services', async () => {
    const calls: string[] = [];
    const repositories = new Map([
      ['profile-a', createRepository('profile-a', calls)],
      ['profile-b', createRepository('profile-b', calls)],
    ]);
    const closeCalls: string[] = [];
    const ingress = new ProxyAgentTrackingIngress(
      createPool(repositories, closeCalls),
      'shared'
    );

    await Promise.all([
      ingress.enqueue(summary('profile-a', 'request-a', 10)),
      ingress.enqueue(summary('profile-b', 'request-b', 20)),
    ]);
    await ingress.close();

    assert.ok(calls.includes('profile-a:agent:request-a'));
    assert.ok(calls.includes('profile-b:agent:request-b'));
    assert.deepEqual(closeCalls, ['closeAll']);
  });

  it('drains pending work before closing the database pool', async () => {
    const calls: string[] = [];
    const repositories = new Map([
      ['profile-a', createRepository('profile-a', calls)],
    ]);
    const closeCalls: string[] = [];
    const ingress = new ProxyAgentTrackingIngress(
      createPool(repositories, closeCalls),
      'profile-a'
    );

    const pending = ingress.enqueue(summary('profile-a', 'request-1', 10));
    await ingress.close();
    await pending;

    assert.ok(calls.includes('profile-a:delta:request-1'));
    assert.deepEqual(closeCalls, ['closeAll']);
    await assert.rejects(
      ingress.enqueue(summary('profile-a', 'request-2', 20)),
      /ingress is closed/
    );
  });

  it('shares concurrent close calls and closes the database pool once', async () => {
    const repositories = new Map([
      ['profile-a', createRepository('profile-a', [])],
    ]);
    const closeCalls: string[] = [];
    const ingress = new ProxyAgentTrackingIngress(
      createPool(repositories, closeCalls),
      'profile-a'
    );

    await Promise.all([ingress.close(), ingress.close(), ingress.close()]);

    assert.deepEqual(closeCalls, ['closeAll']);
  });
});
