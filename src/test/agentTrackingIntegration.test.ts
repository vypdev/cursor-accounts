import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AgentTrackingDatabase } from '../persistence/agentTrackingDatabase';
import { SqliteExecutor } from '../persistence/sqliteExecutor';
import { AgentTrackingService } from '../services/agentTrackingService';
import type { ProxyTrafficSummary } from '../proxy/types';

const extensionPath = path.join(__dirname, '..', '..');

describe('AgentTracking integration', () => {
  let tempDir = '';

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('end-to-end ingest and query conversation totals', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-integration-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const repo = new AgentTrackingDatabase(dbPath, extensionPath);
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    await service.ingestTraffic({
      timestamp: new Date(1_000_000).toISOString(),
      kind: 'response',
      url: 'https://agent.cursor.sh/BidiAppend',
      host: 'agent.cursor.sh',
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
    } satisfies ProxyTrafficSummary);

    await service.ingestTraffic({
      timestamp: new Date(2_000_000).toISOString(),
      kind: 'response',
      url: 'https://agent.cursor.sh/BidiPoll',
      host: 'agent.cursor.sh',
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
    } satisfies ProxyTrafficSummary);

    const result = await service.getConversationTokens('conv-1');
    assert.equal(result.agentCount, 1);
    assert.equal(result.totalInputTokens, 50);
    assert.equal(result.totalOutputTokens, 100);
    assert.equal(result.totalCacheReadTokens, 20);
    assert.ok(result.models.includes('claude-sonnet'));
  });

  it('end-to-end parent-child subagent tree', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-integration-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const repo = new AgentTrackingDatabase(dbPath, extensionPath);
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    const base = {
      kind: 'response',
      host: 'agent.cursor.sh',
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
    } satisfies ProxyTrafficSummary);

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
    } satisfies ProxyTrafficSummary);

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
    } satisfies ProxyTrafficSummary);

    const tree = await service.getAgentTree('conv-1');
    assert.equal(tree.length, 1);
    assert.equal(tree[0]?.requestId, 'req-parent');
    assert.equal(tree[0]?.children.length, 2);
    const childIds = tree[0]?.children.map((child) => child.requestId).sort();
    assert.deepEqual(childIds, ['req-sub1', 'req-sub2']);
  });

  it('persists multiple RunSSE turns with turn_index', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-integration-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const repo = new AgentTrackingDatabase(dbPath, extensionPath);
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
      kind: 'response',
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      host: 'agent.api5.cursor.sh',
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
    } satisfies ProxyTrafficSummary);

    const breakdown = await service.getAgentTokens('req-runsse');
    assert.ok(breakdown);
    assert.equal(breakdown?.peakStreamingTokens, 300);

    const executor = new SqliteExecutor(dbPath, extensionPath);
    const rows = executor.queryRows<{
      turn_index: number | null;
      streaming_tokens: number | null;
      http_request_id: string | null;
    }>(`
SELECT turn_index, streaming_tokens, http_request_id
FROM agent_tokens
WHERE request_id = 'req-runsse'
ORDER BY turn_index ASC;
`);

    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.turn_index, 0);
    assert.equal(rows[0]?.streaming_tokens, 300);
    assert.equal(rows[0]?.http_request_id, 'http-req-runsse');
    assert.equal(rows[1]?.turn_index, 1);
    assert.equal(rows[1]?.streaming_tokens, 250);
  });

  it('persists turn_ended incrementally and skips live token_delta', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-integration-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const repo = new AgentTrackingDatabase(dbPath, extensionPath);
    const service = new AgentTrackingService(repo, 'prof-1');
    await service.initialize();

    const base = {
      timestamp: new Date(1_000_000).toISOString(),
      kind: 'response',
      url: 'https://agent.api5.cursor.sh/agent.v1.AgentService/RunSSE',
      host: 'agent.api5.cursor.sh',
      endpoint: '/agent.v1.AgentService/RunSSE',
      httpRequestId: 'http-req-runsse',
    } as const;

    await service.ingestTraffic({
      ...base,
      insights: {
        agent: {
          requestId: 'req-runsse',
          conversationId: 'conv-runsse',
        },
      },
    } satisfies ProxyTrafficSummary);

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
      } satisfies ProxyTrafficSummary);
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
    } satisfies ProxyTrafficSummary);

    const executor = new SqliteExecutor(dbPath, extensionPath);
    const rows = executor.queryRows<{
      token_type: string;
      input_tokens: number | null;
      output_tokens: number | null;
    }>(`
SELECT token_type, input_tokens, output_tokens
FROM agent_tokens
WHERE request_id = 'req-runsse';
`);

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.token_type, 'turn_ended');
    assert.equal(rows[0]?.input_tokens, 800);
    assert.equal(rows[0]?.output_tokens, 150);
  });
});
