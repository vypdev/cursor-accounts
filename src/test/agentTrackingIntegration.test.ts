import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { IDatabaseConnectionManager } from '../domain/ports/IDatabaseConnectionManager';
import type { IAgentTrackingRepository } from '../domain/ports/IAgentTrackingRepository';
import type { IModelPricingProvider } from '../domain/ports/IModelPricingProvider';
import { ProxyLiveCostCalculator } from '../domain/services/ProxyLiveCostCalculator';
import { BetterSqliteAgentTrackingRepository } from '../persistence/betterSqlite/betterSqliteAgentTrackingRepository';
import { BetterSqliteConnectionManager } from '../persistence/betterSqlite/betterSqliteConnectionManager';
import { AgentTrackingService } from '../services/agentTrackingService';
import type { ProxyTrafficUsageEvent } from '../domain/types/proxyTraffic';

const extensionPath = path.join(__dirname, '..', '..');

const goldenPricingProvider: IModelPricingProvider = {
  getCatalogMetadata() {
    return {
      version: 'test-catalog',
      sourceUrl: 'https://example.test/pricing',
      retrievedOn: '2026-08-26',
      coverage: 'official-visible-models-plus-legacy-compatibility',
    };
  },
  getPricingForModel(modelId) {
    return modelId === 'golden-model'
      ? {
          modelId,
          displayName: 'Golden Test Model',
          provider: 'Unknown',
          inputPer1M: 1,
          outputPer1M: 3,
          cacheReadPer1M: 0.1,
          cacheWritePer1M: 1.25,
          hiddenByDefault: false,
        }
      : null;
  },
  getAllModelPricing() {
    return [];
  },
};

async function createRepository(
  dbPath: string,
  connectionManager: IDatabaseConnectionManager
): Promise<IAgentTrackingRepository> {
  const repo = new BetterSqliteAgentTrackingRepository(
    connectionManager,
    dbPath,
    extensionPath
  );
  await repo.initialize();
  return repo;
}

describe('AgentTracking integration', () => {
  let tempDir = '';
  let connectionManager: BetterSqliteConnectionManager | undefined;

  afterEach(async () => {
    if (connectionManager) {
      await connectionManager.closeAllConnections();
      connectionManager = undefined;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('end-to-end ingest and query conversation totals', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-integration-'));
    connectionManager = new BetterSqliteConnectionManager();
    const dbPath = path.join(tempDir, 'efficiency.db');
    const repo = await createRepository(dbPath, connectionManager);
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    await service.ingestTraffic({
      timestamp: new Date(1_000_000).toISOString(),
      url: 'https://agent.cursor.sh/BidiAppend',
      endpoint: '/BidiAppend',
      insights: {
        agent: {
          requestId: 'req-parent',
          conversationId: 'conv-1',
          streamingTokens: 150,
          usageEvent: 'token_delta',
        },
        tokens: {
          modelName: 'claude-sonnet',
        },
      },
    } satisfies ProxyTrafficUsageEvent);

    await service.ingestTraffic({
      timestamp: new Date(2_000_000).toISOString(),
      url: 'https://agent.cursor.sh/BidiPoll',
      endpoint: '/BidiPoll',
      insights: {
        agent: {
          requestId: 'req-parent',
          conversationId: 'conv-1',
          inputTokens: 50,
          outputTokens: 100,
          cacheReadTokens: 20,
          usageEvent: 'turn_ended',
          eof: true,
        },
        tokens: {
          modelName: 'claude-sonnet',
        },
      },
    } satisfies ProxyTrafficUsageEvent);

    const result = await service.getConversationTokens('conv-1');
    assert.equal(result.agentCount, 1);
    assert.equal(result.totalInputTokens, 50);
    assert.equal(result.totalOutputTokens, 100);
    assert.equal(result.totalCacheReadTokens, 20);
    assert.equal(result.totalDeltaTokens, 150);
    assert.ok(result.models.includes('claude-sonnet'));
  });

  it('reconciles live estimates and model-aware completion cost without double counting', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-accounting-golden-'));
    connectionManager = new BetterSqliteConnectionManager();
    const dbPath = path.join(tempDir, 'efficiency.db');
    const repo = await createRepository(dbPath, connectionManager);
    const service = new AgentTrackingService(
      repo,
      'prof-golden',
      undefined,
      new ProxyLiveCostCalculator(goldenPricingProvider)
    );
    await service.initialize();

    const liveEvent = {
      timestamp: new Date(1_000_000).toISOString(),
      url: 'https://agent.cursor.sh/RunSSE',
      endpoint: '/RunSSE',
      httpRequestId: 'http-golden-live',
      isLiveTokenUpdate: true,
      liveTokenData: {
        accumulatedTokens: 1_000,
        latestDelta: 1_000,
        modelId: 'golden-model',
      },
      insights: {
        agent: {
          requestId: 'request-golden',
          conversationId: 'conversation-golden',
          usageEvent: 'token_delta',
          requestedModelId: 'golden-model',
        },
      },
    } satisfies ProxyTrafficUsageEvent;

    const completionEvent = {
      timestamp: new Date(1_001_000).toISOString(),
      url: 'https://agent.cursor.sh/RunSSE',
      endpoint: '/RunSSE',
      httpRequestId: 'http-golden-completion',
      isTurnEnded: true,
      insights: {
        agent: {
          requestId: 'request-golden',
          conversationId: 'conversation-golden',
          usageEvent: 'turn_ended',
          requestedModelId: 'golden-model',
          inputTokens: 1_000,
          outputTokens: 500,
          cacheReadTokens: 200,
          cacheWriteTokens: 100,
        },
      },
    } satisfies ProxyTrafficUsageEvent;

    await service.ingestTraffic(liveEvent);
    await service.ingestTraffic(liveEvent);
    await service.ingestTraffic(completionEvent);
    await service.ingestTraffic(completionEvent);

    const totals = await service.getConversationTokens('conversation-golden');
    assert.equal(totals.totalDeltaTokens, 1_000);
    assert.ok(Math.abs(totals.totalDeltaCostCents - 0.2) < 0.000001);
    assert.equal(totals.totalInputTokens, 1_000);
    assert.equal(totals.totalOutputTokens, 500);
    assert.equal(totals.totalCacheReadTokens, 200);
    assert.equal(totals.totalCacheWriteTokens, 100);
    assert.equal(totals.totalTokens, 1_800);
    assert.ok(Math.abs(totals.totalTurnCostCents - 0.2645) < 0.000001);

    const completedTurns = await service.getConversationTurnEnded('conversation-golden');
    assert.equal(completedTurns.length, 1);
    assert.ok(Math.abs((completedTurns[0]?.totalCents ?? 0) - 0.2645) < 0.000001);
  });

  it('end-to-end parent-child subagent tree', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-integration-'));
    connectionManager = new BetterSqliteConnectionManager();
    const dbPath = path.join(tempDir, 'efficiency.db');
    const repo = await createRepository(dbPath, connectionManager);
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    const base = {
      endpoint: '/BidiAppend',
    } as const;

    await service.ingestTraffic({
      ...base,
      timestamp: new Date(1_000_000).toISOString(),
      url: 'https://agent.cursor.sh/BidiAppend',
      insights: {
        agent: {
          requestId: 'req-parent',
          conversationId: 'conv-1',
          usageEvent: 'token_delta',
          streamingTokens: 10,
        },
      },
    } satisfies ProxyTrafficUsageEvent);

    await service.ingestTraffic({
      ...base,
      timestamp: new Date(1_500_000).toISOString(),
      url: 'https://agent.cursor.sh/BidiAppend',
      insights: {
        agent: {
          requestId: 'req-sub1',
          conversationId: 'conv-1',
          parentRequestId: 'req-parent',
          usageEvent: 'token_delta',
          streamingTokens: 20,
        },
      },
    } satisfies ProxyTrafficUsageEvent);

    await service.ingestTraffic({
      ...base,
      timestamp: new Date(1_600_000).toISOString(),
      url: 'https://agent.cursor.sh/BidiAppend',
      insights: {
        agent: {
          requestId: 'req-sub2',
          conversationId: 'conv-1',
          parentRequestId: 'req-parent',
          usageEvent: 'token_delta',
          streamingTokens: 30,
        },
      },
    } satisfies ProxyTrafficUsageEvent);

    const tree = await service.getAgentTree('conv-1');
    assert.equal(tree.length, 1);
    assert.equal(tree[0]?.requestId, 'req-parent');
    assert.equal(tree[0]?.children.length, 2);
    const childIds = tree[0]?.children.map((child) => child.requestId).sort();
    assert.deepEqual(childIds, ['req-sub1', 'req-sub2']);
  });

  it('does not double-count replayed live deltas or completed turns', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-integration-'));
    connectionManager = new BetterSqliteConnectionManager();
    const dbPath = path.join(tempDir, 'efficiency.db');
    const repo = await createRepository(dbPath, connectionManager);
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    const liveSummary = {
      timestamp: new Date(1_000_000).toISOString(),
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      endpoint: '/agent.v1.AgentService/RunSSE',
      httpRequestId: 'http-replay-test',
      isLiveTokenUpdate: true,
      liveTokenData: {
        accumulatedTokens: 100,
        latestDelta: 100,
      },
      insights: {
        agent: {
          requestId: 'req-replay',
          conversationId: 'conv-replay',
          usageEvent: 'token_delta',
          eventSequence: 3,
        },
      },
    } satisfies ProxyTrafficUsageEvent;

    await service.ingestTraffic(liveSummary);
    await service.ingestTraffic(liveSummary);

    await service.ingestTraffic({
      ...liveSummary,
      liveTokenData: {
        accumulatedTokens: 150,
        latestDelta: 50,
      },
      insights: {
        agent: {
          requestId: 'req-replay',
          conversationId: 'conv-replay',
          usageEvent: 'token_delta',
          eventSequence: 4,
        },
      },
    });

    await service.ingestTraffic({
      ...liveSummary,
      isLiveTokenUpdate: false,
      isTurnEnded: true,
      liveTokenData: undefined,
      insights: {
        agent: {
          requestId: 'req-replay',
          conversationId: 'conv-replay',
          usageEvent: 'turn_ended',
          inputTokens: 50,
          outputTokens: 75,
          eventSequence: 5,
          eof: true,
        },
      },
    });
    await service.ingestTraffic({
      ...liveSummary,
      isLiveTokenUpdate: false,
      isTurnEnded: true,
      liveTokenData: undefined,
      insights: {
        agent: {
          requestId: 'req-replay',
          conversationId: 'conv-replay',
          usageEvent: 'turn_ended',
          inputTokens: 50,
          outputTokens: 75,
          eventSequence: 5,
          eof: true,
        },
      },
    });

    const totals = await service.getConversationTokens('conv-replay');
    assert.equal(totals.totalDeltaTokens, 150);
    assert.equal(totals.totalInputTokens, 50);
    assert.equal(totals.totalOutputTokens, 75);

    const completedTurns = await service.getConversationTurnEnded('conv-replay');
    assert.equal(completedTurns.length, 1);

    const conn = await connectionManager.getConnection(dbPath);
    const eventRows = conn.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM agent_tokens_delta_events'
    );
    assert.equal(eventRows?.count, 2);
  });

  it('persists multiple RunSSE turns with turn_index', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-integration-'));
    connectionManager = new BetterSqliteConnectionManager();
    const dbPath = path.join(tempDir, 'efficiency.db');
    const repo = await createRepository(dbPath, connectionManager);
    const { TokenTurnDetectionService } = await import(
      '../domain/services/tokenTurnDetectionService'
    );
    const service = new AgentTrackingService(
      repo,
      'prof-1',
      new TokenTurnDetectionService()
    );
    await service.initialize();

    await service.ingestTraffic({
      timestamp: new Date(1_000_000).toISOString(),
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      endpoint: '/agent.v1.AgentService/RunSSE',
      httpRequestId: 'http-req-runsse',
      insights: {
        agent: {
          requestId: 'req-runsse',
          conversationId: 'conv-runsse',
        },
        allTokenFrames: [
          { streamingTokens: 300, usageEvent: 'token_delta' },
          { streamingTokens: 120, usageEvent: 'token_delta' },
          { streamingTokens: 250, usageEvent: 'token_delta' },
        ],
      },
    } satisfies ProxyTrafficUsageEvent);

    const breakdown = await service.getAgentTokens('req-runsse');
    assert.ok(breakdown);
    assert.equal(breakdown?.peakStreamingTokens, 300);

    const conn = await connectionManager.getConnection(dbPath);
    const rows = conn.all<{
      turn_index: number | null;
      streaming_tokens: number | null;
      http_request_id: string | null;
    }>(`
SELECT turn_index, streaming_tokens, http_request_id
FROM agent_tokens
WHERE request_id = ?
ORDER BY turn_index ASC;
`, 'req-runsse');

    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.turn_index, 0);
    assert.equal(rows[0]?.streaming_tokens, 300);
    assert.equal(rows[0]?.http_request_id, 'http-req-runsse');
    assert.equal(rows[1]?.turn_index, 1);
    assert.equal(rows[1]?.streaming_tokens, 250);
  });

  it('persists live token_delta into one minute bucket and turn_ended separately', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-integration-'));
    connectionManager = new BetterSqliteConnectionManager();
    const dbPath = path.join(tempDir, 'efficiency.db');
    const repo = await createRepository(dbPath, connectionManager);
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    const base = {
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      endpoint: '/agent.v1.AgentService/RunSSE',
      httpRequestId: 'http-req-runsse',
    } as const;

    await service.ingestTraffic({
      ...base,
      timestamp: new Date(1_000_000).toISOString(),
      insights: {
        agent: {
          requestId: 'req-runsse',
          conversationId: 'conv-runsse',
        },
      },
    } satisfies ProxyTrafficUsageEvent);

    for (let i = 0; i < 5; i++) {
      await service.ingestTraffic({
        ...base,
        timestamp: new Date(1_100_000 + i).toISOString(),
        isLiveTokenUpdate: true,
        liveTokenData: { accumulatedTokens: (i + 1) * 50, latestDelta: 50 },
        insights: {
          agent: {
            requestId: 'req-runsse',
            streamingTokens: (i + 1) * 50,
            usageEvent: 'token_delta',
          },
        },
      } satisfies ProxyTrafficUsageEvent);
    }

    await service.ingestTraffic({
      ...base,
      timestamp: new Date(1_200_000).toISOString(),
      isTurnEnded: true,
      insights: {
        agent: {
          requestId: 'req-runsse',
          inputTokens: 800,
          outputTokens: 150,
          usageEvent: 'turn_ended',
        },
        streamingTurnsAlreadyPersisted: true,
      },
    } satisfies ProxyTrafficUsageEvent);

    const conn = await connectionManager.getConnection(dbPath);
    const deltaRows = conn.all<{
      delta_tokens: number | null;
      minute_bucket: number | null;
    }>(`
SELECT delta_tokens, minute_bucket
FROM agent_tokens_delta
WHERE request_id = ?;
`, 'req-runsse');
    const turnRows = conn.all<{
      input_tokens: number | null;
      output_tokens: number | null;
    }>(`
SELECT input_tokens, output_tokens
FROM agent_turn_ended
WHERE request_id = ?;
`, 'req-runsse');

    assert.equal(deltaRows.length, 1);
    assert.equal(deltaRows[0]?.delta_tokens, 250);
    assert.equal(turnRows.length, 1);
    assert.equal(turnRows[0]?.input_tokens, 800);
    assert.equal(turnRows[0]?.output_tokens, 150);
  });

  it('aggregates 100 live token_delta events into 5 minute buckets', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-integration-'));
    connectionManager = new BetterSqliteConnectionManager();
    const dbPath = path.join(tempDir, 'efficiency.db');
    const repo = await createRepository(dbPath, connectionManager);
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    const baseSecond = 1_740_000_000;
    const perMinute = [20, 10, 10, 30, 30];

    await service.ingestTraffic({
      timestamp: new Date(baseSecond * 1000).toISOString(),
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      endpoint: '/agent.v1.AgentService/RunSSE',
      insights: {
        agent: {
          requestId: 'req-live',
          conversationId: 'conv-live',
        },
      },
    } satisfies ProxyTrafficUsageEvent);

    for (let minute = 0; minute < perMinute.length; minute++) {
      for (let i = 0; i < perMinute[minute]!; i++) {
        await service.ingestTraffic({
          timestamp: new Date((baseSecond + minute * 60 + i) * 1000).toISOString(),
          url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
          endpoint: '/agent.v1.AgentService/RunSSE',
          isLiveTokenUpdate: true,
          liveTokenData: {
            accumulatedTokens: (i + 1) * 5,
            latestDelta: 5,
            deltaCostCents: 0.1,
          },
          insights: {
            agent: {
              requestId: 'req-live',
              streamingTokens: (i + 1) * 5,
              usageEvent: 'token_delta',
            },
          },
        } satisfies ProxyTrafficUsageEvent);
      }
    }

    const conn = await connectionManager.getConnection(dbPath);
    const deltaRows = conn.all<{
      minute_bucket: number | null;
      delta_tokens: number | null;
      delta_cost: number | null;
    }>(`
SELECT minute_bucket, delta_tokens, delta_cost
FROM agent_tokens_delta
WHERE request_id = ?
ORDER BY minute_bucket ASC;
`, 'req-live');

    assert.equal(deltaRows.length, 5);
    assert.deepEqual(
      deltaRows.map((row) => row.delta_tokens),
      perMinute.map((count) => count * 5)
    );
    for (let i = 0; i < perMinute.length; i++) {
      assert.ok(
        Math.abs((deltaRows[i]?.delta_cost ?? 0) - perMinute[i]! * 0.1) < 0.0001
      );
    }

    const totals = await service.getConversationDeltaTokens('conv-live');
    assert.equal(totals.minuteBuckets, 5);
    assert.equal(totals.totalStreamingTokens, 500);
    assert.ok(Math.abs(totals.totalCostCents - 10) < 0.0001);
  });
});
