import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IAgentTrackingRepository } from '../../domain/ports/IAgentTrackingRepository';
import { AgentTrackingService } from '../../services/agentTrackingService';
import type { ProxyTrafficSummary } from '../../proxy/types';

class MockRepository implements IAgentTrackingRepository {
  conversations: Array<{ conversationId: string; timestamp: number }> = [];
  agents: Array<{ requestId: string; conversationId: string }> = [];
  tokens: Array<{ requestId: string; tokenType: string }> = [];

  async initialize(): Promise<void> {}

  async upsertConversation(
    conversationId: string,
    _profileId: string,
    timestamp: number
  ): Promise<void> {
    this.conversations.push({ conversationId, timestamp });
  }

  async upsertAgent(agent: {
    requestId: string;
    conversationId: string;
  }): Promise<void> {
    this.agents.push({
      requestId: agent.requestId,
      conversationId: agent.conversationId,
    });
  }

  async insertTokenSnapshot(tokens: {
    requestId: string;
    tokenType: string;
  }): Promise<void> {
    this.tokens.push({
      requestId: tokens.requestId,
      tokenType: tokens.tokenType,
    });
  }

  async getTotalConversationTokens() {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalTokens: 0,
      agentCount: 0,
      models: [],
      startedAt: 0,
      endedAt: 0,
    };
  }

  async getAgentTokens() {
    return null;
  }

  async getAgentTree() {
    return [];
  }

  async getDatabaseSize() {
    return 0;
  }

  async deleteOldConversations() {
    return 0;
  }
}

describe('AgentTrackingService', () => {
  it('ingests traffic with conversation and agent data', async () => {
    const repo = new MockRepository();
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    const summary = {
      timestamp: new Date(1_000_000).toISOString(),
      kind: 'response',
      url: 'https://agent.cursor.sh/BidiAppend',
      host: 'agent.cursor.sh',
      endpoint: '/BidiAppend',
      insights: {
        agent: {
          requestId: 'req-123',
          conversationId: 'conv-456',
          streamingTokens: 100,
          usageEvent: 'token_delta',
        },
      },
    } satisfies ProxyTrafficSummary;

    await service.ingestTraffic(summary);

    assert.equal(repo.conversations.length, 1);
    assert.equal(repo.conversations[0]?.conversationId, 'conv-456');
    assert.equal(repo.agents.length, 1);
    assert.equal(repo.agents[0]?.requestId, 'req-123');
    assert.equal(repo.tokens.length, 1);
    assert.equal(repo.tokens[0]?.tokenType, 'delta');
  });

  it('skips traffic without conversation_id', async () => {
    const repo = new MockRepository();
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    const summary = {
      timestamp: new Date().toISOString(),
      kind: 'response',
      url: 'https://agent.cursor.sh/BidiAppend',
      host: 'agent.cursor.sh',
      endpoint: '/BidiAppend',
      insights: {
        agent: {
          requestId: 'req-123',
          streamingTokens: 100,
          usageEvent: 'token_delta',
        },
      },
    } satisfies ProxyTrafficSummary;

    await service.ingestTraffic(summary);

    assert.equal(repo.conversations.length, 0);
    assert.equal(repo.agents.length, 0);
  });

  it('does not throw when repository upsert fails', async () => {
    const failingRepo: IAgentTrackingRepository = {
      async initialize() {},
      async upsertConversation() {
        throw new Error('DB error');
      },
      async upsertAgent() {},
      async insertTokenSnapshot() {},
      async getTotalConversationTokens() {
        return {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheReadTokens: 0,
          totalCacheWriteTokens: 0,
          totalTokens: 0,
          agentCount: 0,
          models: [],
          startedAt: 0,
          endedAt: 0,
        };
      },
      async getAgentTokens() {
        return null;
      },
      async getAgentTree() {
        return [];
      },
      async getDatabaseSize() {
        return 0;
      },
      async deleteOldConversations() {
        return 0;
      },
    };

    const service = new AgentTrackingService(failingRepo, 'prof-1');
    await service.initialize();

    const summary = {
      timestamp: new Date().toISOString(),
      kind: 'response',
      url: 'https://agent.cursor.sh/BidiAppend',
      host: 'agent.cursor.sh',
      endpoint: '/BidiAppend',
      insights: {
        agent: {
          requestId: 'req-1',
          conversationId: 'conv-1',
        },
      },
    } satisfies ProxyTrafficSummary;

    await assert.doesNotReject(async () => {
      await service.ingestTraffic(summary);
    });
  });
});
