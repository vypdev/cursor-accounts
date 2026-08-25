import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IAgentTrackingRepository } from '../../domain/ports/IAgentTrackingRepository';
import type {
  DetectedTurn,
  ITokenTurnDetectionService,
} from '../../domain/ports/ITokenTurnDetectionService';
import { AgentTrackingService } from '../../services/agentTrackingService';
import type { ProxyTrafficUsageEvent } from '../../domain/types/proxyTraffic';

class MockRepository implements IAgentTrackingRepository {
  conversations: Array<{ conversationId: string; timestamp: number }> = [];
  agents: Array<{ requestId: string; conversationId: string }> = [];
  tokens: Array<{
    requestId: string;
    tokenType: string;
    turnIndex?: number;
    httpRequestId?: string;
    streamingTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  }> = [];
  deltas: Array<{
    requestId: string;
    minuteBucket: number;
    streamingTokens: number;
    costCents?: number;
    contextUsedTokens?: number;
    contextMaxTokens?: number;
    recordedAt?: number;
  }> = [];
  turnEnded: Array<{
    requestId: string;
    inputTokens: number;
    outputTokens: number;
  }> = [];
  agentsByRequestId = new Map<
    string,
    { requestId: string; conversationId: string }
  >();

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
    this.agentsByRequestId.set(agent.requestId, {
      requestId: agent.requestId,
      conversationId: agent.conversationId,
    });
  }

  async insertTokenSnapshot(tokens: {
    requestId: string;
    tokenType: string;
    turnIndex?: number;
    httpRequestId?: string;
    streamingTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  }): Promise<void> {
    this.tokens.push({
      requestId: tokens.requestId,
      tokenType: tokens.tokenType,
      turnIndex: tokens.turnIndex,
      httpRequestId: tokens.httpRequestId,
      streamingTokens: tokens.streamingTokens,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
    });
  }

  async upsertTokenDelta(delta: {
    requestId: string;
    minuteBucket: number;
    streamingTokens: number;
    costCents?: number;
    contextUsedTokens?: number;
    contextMaxTokens?: number;
    recordedAt?: number;
  }): Promise<void> {
    const existing = this.deltas.find(
      (row) =>
        row.requestId === delta.requestId &&
        row.minuteBucket === delta.minuteBucket
    );
    if (existing) {
      existing.streamingTokens += delta.streamingTokens;
      existing.costCents = (existing.costCents ?? 0) + (delta.costCents ?? 0);
      if (delta.contextUsedTokens != null) {
        existing.contextUsedTokens = delta.contextUsedTokens;
      }
      if (delta.contextMaxTokens != null) {
        existing.contextMaxTokens = delta.contextMaxTokens;
      }
      if (delta.recordedAt != null) {
        existing.recordedAt = delta.recordedAt;
      }
      return;
    }
    this.deltas.push({ ...delta });
  }

  async insertTurnEnded(turn: {
    requestId: string;
    inputTokens: number;
    outputTokens: number;
  }): Promise<void> {
    this.turnEnded.push({
      requestId: turn.requestId,
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
    });
  }

  async getTotalConversationTokens() {
    return {
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
    };
  }

  async getTotalDeltaTokensByConversation() {
    return { totalStreamingTokens: 0, totalCostCents: 0, minuteBuckets: 0 };
  }

  async getTurnEndedByConversation() {
    return [];
  }

  async getAgentTokens(requestId: string) {
    const agent = this.agentsByRequestId.get(requestId);
    if (!agent) {
      return null;
    }
    return {
      requestId: agent.requestId,
      conversationId: agent.conversationId,
      startedAt: 0,
      peakStreamingTokens: 0,
      finalInputTokens: 0,
      finalOutputTokens: 0,
      finalCacheReadTokens: 0,
      finalCacheWriteTokens: 0,
      finalTotalTokens: 0,
    };
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
      url: 'https://agent.cursor.sh/BidiAppend',
      endpoint: '/BidiAppend',
      insights: {
        agent: {
          requestId: 'req-123',
          conversationId: 'conv-456',
          streamingTokens: 100,
          usageEvent: 'token_delta',
        },
      },
    } satisfies ProxyTrafficUsageEvent;

    await service.ingestTraffic(summary);

    assert.equal(repo.conversations.length, 1);
    assert.equal(repo.conversations[0]?.conversationId, 'conv-456');
    assert.equal(repo.agents.length, 1);
    assert.equal(repo.agents[0]?.requestId, 'req-123');
    assert.equal(repo.deltas.length, 1);
    assert.equal(repo.deltas[0]?.streamingTokens, 100);
  });

  it('resolves conversation_id from existing agent for RunSSE without conversation_id', async () => {
    const repo = new MockRepository();
    repo.agentsByRequestId.set('bidi-req-1', {
      requestId: 'bidi-req-1',
      conversationId: 'conv-from-db',
    });
    const turnDetection: ITokenTurnDetectionService = {
      detectTurns() {
        return [{ streamingTokens: 300, turnIndex: 0 }] satisfies DetectedTurn[];
      },
    };
    const service = new AgentTrackingService(repo, 'prof-1', turnDetection);
    await service.initialize();

    await service.ingestTraffic({
      timestamp: new Date(1_000_000).toISOString(),
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      endpoint: '/agent.v1.AgentService/RunSSE',
      httpRequestId: 'http-req-1',
      insights: {
        agent: {
          requestId: 'bidi-req-1',
        },
        allTokenFrames: [
          { streamingTokens: 300, usageEvent: 'token_delta' },
          { streamingTokens: 100, usageEvent: 'token_delta' },
        ],
      },
    } satisfies ProxyTrafficUsageEvent);

    assert.equal(repo.conversations.length, 1);
    assert.equal(repo.conversations[0]?.conversationId, 'conv-from-db');
    assert.equal(repo.tokens.length, 1);
    assert.equal(repo.tokens[0]?.requestId, 'bidi-req-1');
    assert.equal(repo.tokens[0]?.turnIndex, 0);
  });

  it('skips traffic without conversation_id', async () => {
    const repo = new MockRepository();
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    const summary = {
      timestamp: new Date().toISOString(),
      url: 'https://agent.cursor.sh/BidiAppend',
      endpoint: '/BidiAppend',
      insights: {
        agent: {
          requestId: 'req-123',
          streamingTokens: 100,
          usageEvent: 'token_delta',
        },
      },
    } satisfies ProxyTrafficUsageEvent;

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
      async upsertTokenDelta() {},
      async insertTurnEnded() {},
      async getTotalConversationTokens() {
        return {
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
        };
      },
      async getTotalDeltaTokensByConversation() {
        return { totalStreamingTokens: 0, totalCostCents: 0, minuteBuckets: 0 };
      },
      async getTurnEndedByConversation() {
        return [];
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
      url: 'https://agent.cursor.sh/BidiAppend',
      endpoint: '/BidiAppend',
      insights: {
        agent: {
          requestId: 'req-1',
          conversationId: 'conv-1',
        },
      },
    } satisfies ProxyTrafficUsageEvent;

    await assert.doesNotReject(async () => {
      await service.ingestTraffic(summary);
    });
  });

  it('persists one snapshot per detected RunSSE turn', async () => {
    const repo = new MockRepository();
    const turnDetection: ITokenTurnDetectionService = {
      detectTurns() {
        return [
          { streamingTokens: 300, turnIndex: 0 },
          { streamingTokens: 200, turnIndex: 1 },
        ] satisfies DetectedTurn[];
      },
    };
    const service = new AgentTrackingService(repo, 'prof-1', turnDetection);
    await service.initialize();

    await service.ingestTraffic({
      timestamp: new Date(1_000_000).toISOString(),
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      endpoint: '/agent.v1.AgentService/RunSSE',
      httpRequestId: 'http-req-1',
      insights: {
        agent: {
          requestId: 'bidi-req-1',
          conversationId: 'conv-456',
        },
        allTokenFrames: [
          { streamingTokens: 300, usageEvent: 'token_delta' },
          { streamingTokens: 100, usageEvent: 'token_delta' },
          { streamingTokens: 200, usageEvent: 'token_delta' },
        ],
      },
    } satisfies ProxyTrafficUsageEvent);

    assert.equal(repo.tokens.length, 2);
    assert.equal(repo.tokens[0]?.requestId, 'bidi-req-1');
    assert.equal(repo.tokens[0]?.turnIndex, 0);
    assert.equal(repo.tokens[0]?.streamingTokens, 300);
    assert.equal(repo.tokens[0]?.httpRequestId, 'http-req-1');
    assert.equal(repo.tokens[1]?.turnIndex, 1);
    assert.equal(repo.tokens[1]?.streamingTokens, 200);
  });

  it('persists live token_delta into minute buckets', async () => {
    const repo = new MockRepository();
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    await service.ingestTraffic({
      timestamp: new Date(1_000_000).toISOString(),
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      endpoint: '/agent.v1.AgentService/RunSSE',
      httpRequestId: 'http-req-1',
      isLiveTokenUpdate: true,
      liveTokenData: { accumulatedTokens: 326, latestDelta: 12 },
      insights: {
        agent: {
          requestId: 'bidi-req-1',
          conversationId: 'conv-456',
          streamingTokens: 326,
          usageEvent: 'token_delta',
        },
      },
    } satisfies ProxyTrafficUsageEvent);

    assert.equal(repo.deltas.length, 1);
    assert.equal(repo.deltas[0]?.streamingTokens, 12);
  });

  it('returns deltaPersisted after live token_delta is stored', async () => {
    const repo = new MockRepository();
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    const result = await service.ingestTraffic({
      timestamp: new Date(1_000_000).toISOString(),
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      endpoint: '/agent.v1.AgentService/RunSSE',
      isLiveTokenUpdate: true,
      liveTokenData: { accumulatedTokens: 12, latestDelta: 12 },
      insights: {
        agent: {
          requestId: 'bidi-req-1',
          conversationId: 'conv-456',
          streamingTokens: 12,
          usageEvent: 'token_delta',
        },
      },
    } satisfies ProxyTrafficUsageEvent);

    assert.deepEqual(result, {
      conversationId: 'conv-456',
      deltaPersisted: true,
      turnEndedPersisted: false,
      contextPersisted: false,
    });
  });

  it('persists context snapshot from token_details events', async () => {
    const repo = new MockRepository();
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    const result = await service.ingestTraffic({
      timestamp: new Date(1_000_000).toISOString(),
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      endpoint: '/agent.v1.AgentService/RunSSE',
      insights: {
        agent: {
          requestId: 'bidi-req-1',
          conversationId: 'conv-456',
          contextUsedTokens: 42_000,
          maxTokens: 200_000,
          usageEvent: 'token_details',
        },
      },
    } satisfies ProxyTrafficUsageEvent);

    assert.deepEqual(result, {
      conversationId: 'conv-456',
      deltaPersisted: false,
      turnEndedPersisted: false,
      contextPersisted: true,
    });
    assert.equal(repo.deltas[0]?.streamingTokens, 0);
    assert.equal(repo.deltas[0]?.contextUsedTokens, 42_000);
    assert.equal(repo.deltas[0]?.contextMaxTokens, 200_000);
  });

  it('persists live token_delta cost from deltaCostCents', async () => {
    const repo = new MockRepository();
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    await service.ingestTraffic({
      timestamp: new Date(1_000_000).toISOString(),
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      endpoint: '/agent.v1.AgentService/RunSSE',
      isLiveTokenUpdate: true,
      liveTokenData: {
        accumulatedTokens: 50,
        latestDelta: 10,
        deltaCostCents: 0.25,
      },
      insights: {
        agent: {
          requestId: 'bidi-req-1',
          conversationId: 'conv-456',
          streamingTokens: 50,
          usageEvent: 'token_delta',
        },
      },
    } satisfies ProxyTrafficUsageEvent);

    assert.equal(repo.deltas[0]?.costCents, 0.25);
  });

  it('calculates live token_delta cost when calculator is provided', async () => {
    const repo = new MockRepository();
    const service = new AgentTrackingService(repo, 'prof-1', undefined, {
      calculateDeltaCost(deltaTokens: number) {
        return deltaTokens * 0.01;
      },
      calculateTurnCost() {
        return 0;
      },
    });
    await service.initialize();

    await service.ingestTraffic({
      timestamp: new Date(1_000_000).toISOString(),
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      endpoint: '/agent.v1.AgentService/RunSSE',
      isLiveTokenUpdate: true,
      liveTokenData: { accumulatedTokens: 20, latestDelta: 20 },
      insights: {
        agent: {
          requestId: 'bidi-req-1',
          conversationId: 'conv-456',
          streamingTokens: 20,
          usageEvent: 'token_delta',
          modelName: 'composer-2.5',
        },
      },
    } satisfies ProxyTrafficUsageEvent);

    assert.equal(repo.deltas[0]?.costCents, 0.2);
  });

  it('persists batch token_delta when streamingTurnsAlreadyPersisted but live path missed', async () => {
    const repo = new MockRepository();
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    await service.ingestTraffic({
      timestamp: new Date(1_000_000).toISOString(),
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      endpoint: '/agent.v1.AgentService/RunSSE',
      httpRequestId: 'http-req-1',
      insights: {
        agent: {
          requestId: 'bidi-req-1',
          conversationId: 'conv-456',
          streamingTokens: 42,
          usageEvent: 'token_delta',
        },
        streamingTurnsAlreadyPersisted: true,
      },
    } satisfies ProxyTrafficUsageEvent);

    assert.equal(repo.deltas.length, 1);
    assert.equal(repo.deltas[0]?.streamingTokens, 42);
  });

  it('persists turn_ended into dedicated table', async () => {
    const repo = new MockRepository();
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    await service.ingestTraffic({
      timestamp: new Date(1_000_000).toISOString(),
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      endpoint: '/agent.v1.AgentService/RunSSE',
      httpRequestId: 'http-req-1',
      isTurnEnded: true,
      insights: {
        agent: {
          requestId: 'bidi-req-1',
          conversationId: 'conv-456',
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 50,
          usageEvent: 'turn_ended',
        },
        streamingTurnsAlreadyPersisted: true,
      },
    } satisfies ProxyTrafficUsageEvent);

    assert.equal(repo.turnEnded.length, 1);
    assert.equal(repo.turnEnded[0]?.inputTokens, 1000);
    assert.equal(repo.turnEnded[0]?.outputTokens, 200);
    assert.equal(repo.tokens.length, 0);
  });
});
