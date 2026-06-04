import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AgentTrackingDatabase } from '../persistence/agentTrackingDatabase';
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
});
