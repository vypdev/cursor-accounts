import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AgentTrackingDatabase } from '../../persistence/agentTrackingDatabase';

const extensionPath = path.join(__dirname, '..', '..', '..');

describe('AgentTrackingDatabase', () => {
  let tempDir = '';

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  async function createDb(): Promise<AgentTrackingDatabase> {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-db-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const db = new AgentTrackingDatabase(dbPath, extensionPath);
    await db.initialize();
    return db;
  }

  it('initializes schema with agent tracking tables', async () => {
    const db = await createDb();
    const size = await db.getDatabaseSize();
    assert.ok(size > 0);
  });

  it('upserts conversation and updates last_activity', async () => {
    const db = await createDb();
    await db.upsertConversation('conv-123', 'prof-1', 1000, 5);
    await db.upsertConversation('conv-123', 'prof-1', 2000, 10);

    const totals = await db.getTotalConversationTokens('conv-123');
    assert.equal(totals.agentCount, 0);
  });

  it('stores agent parent/child relationships and builds tree', async () => {
    const db = await createDb();
    await db.upsertConversation('conv-1', 'prof-1', 1000);

    await db.upsertAgent({
      requestId: 'req-parent',
      conversationId: 'conv-1',
      modelName: 'claude-sonnet',
      startedAt: 1000,
      isEof: false,
      profileId: 'prof-1',
    });

    await db.upsertAgent({
      requestId: 'req-child',
      conversationId: 'conv-1',
      parentRequestId: 'req-parent',
      modelName: 'claude-sonnet',
      startedAt: 1500,
      isEof: false,
      profileId: 'prof-1',
    });

    const tree = await db.getAgentTree('conv-1');
    assert.equal(tree.length, 1);
    assert.equal(tree[0]?.requestId, 'req-parent');
    assert.equal(tree[0]?.children.length, 1);
    assert.equal(tree[0]?.children[0]?.requestId, 'req-child');
  });

  it('tracks token snapshots and computes peak/final values', async () => {
    const db = await createDb();
    await db.upsertConversation('conv-1', 'prof-1', 1000);
    await db.upsertAgent({
      requestId: 'req-1',
      conversationId: 'conv-1',
      startedAt: 1000,
      isEof: false,
      profileId: 'prof-1',
    });

    await db.insertTokenSnapshot({
      requestId: 'req-1',
      tokenType: 'delta',
      streamingTokens: 100,
      recordedAt: 1001,
    });
    await db.insertTokenSnapshot({
      requestId: 'req-1',
      tokenType: 'delta',
      streamingTokens: 250,
      recordedAt: 1002,
    });
    await db.insertTokenSnapshot({
      requestId: 'req-1',
      tokenType: 'turn_ended',
      inputTokens: 50,
      outputTokens: 200,
      cacheReadTokens: 10,
      recordedAt: 1003,
    });

    const tokens = await db.getAgentTokens('req-1');
    assert.ok(tokens);
    assert.equal(tokens.peakStreamingTokens, 250);
    assert.equal(tokens.finalInputTokens, 50);
    assert.equal(tokens.finalOutputTokens, 200);
    assert.equal(tokens.finalCacheReadTokens, 10);
  });

  it('aggregates conversation totals across multiple agents', async () => {
    const db = await createDb();
    await db.upsertConversation('conv-1', 'prof-1', 1000);

    await db.upsertAgent({
      requestId: 'req-1',
      conversationId: 'conv-1',
      modelName: 'claude-sonnet',
      startedAt: 1000,
      endedAt: 2000,
      isEof: true,
      profileId: 'prof-1',
    });
    await db.upsertAgent({
      requestId: 'req-2',
      conversationId: 'conv-1',
      modelName: 'gpt-4',
      startedAt: 2500,
      endedAt: 3000,
      isEof: true,
      profileId: 'prof-1',
    });

    await db.insertTokenSnapshot({
      requestId: 'req-1',
      tokenType: 'turn_ended',
      inputTokens: 100,
      outputTokens: 200,
      recordedAt: 2000,
    });
    await db.insertTokenSnapshot({
      requestId: 'req-2',
      tokenType: 'turn_ended',
      inputTokens: 50,
      outputTokens: 150,
      recordedAt: 3000,
    });

    const result = await db.getTotalConversationTokens('conv-1');
    assert.equal(result.agentCount, 2);
    assert.equal(result.totalInputTokens, 150);
    assert.equal(result.totalOutputTokens, 350);
    assert.ok(result.models.includes('claude-sonnet'));
    assert.ok(result.models.includes('gpt-4'));
  });

  it('returns null for unknown agent tokens', async () => {
    const db = await createDb();
    const tokens = await db.getAgentTokens('missing');
    assert.equal(tokens, null);
  });
});
