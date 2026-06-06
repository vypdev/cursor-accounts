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

    await db.upsertTokenDelta({
      requestId: 'req-1',
      minuteBucket: 960,
      streamingTokens: 100,
    });
    await db.upsertTokenDelta({
      requestId: 'req-1',
      minuteBucket: 960,
      streamingTokens: 150,
    });
    await db.insertTurnEnded({
      requestId: 'req-1',
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

  it('aggregates token_delta within the same minute bucket', async () => {
    const db = await createDb();
    await db.upsertConversation('conv-1', 'prof-1', 1000);
    await db.upsertAgent({
      requestId: 'req-1',
      conversationId: 'conv-1',
      startedAt: 1000,
      isEof: false,
      profileId: 'prof-1',
    });

    await db.upsertTokenDelta({
      requestId: 'req-1',
      minuteBucket: 1_740_000_000,
      streamingTokens: 20,
    });
    await db.upsertTokenDelta({
      requestId: 'req-1',
      minuteBucket: 1_740_000_000,
      streamingTokens: 10,
    });
    await db.upsertTokenDelta({
      requestId: 'req-1',
      minuteBucket: 1_740_000_060,
      streamingTokens: 30,
    });

    const totals = await db.getTotalDeltaTokensByConversation('conv-1');
    assert.equal(totals.totalStreamingTokens, 60);
    assert.equal(totals.minuteBuckets, 2);
  });

  it('aggregates cost_cents within the same minute bucket', async () => {
    const db = await createDb();
    await db.upsertConversation('conv-1', 'prof-1', 1000);
    await db.upsertAgent({
      requestId: 'req-1',
      conversationId: 'conv-1',
      startedAt: 1000,
      isEof: false,
      profileId: 'prof-1',
    });

    await db.upsertTokenDelta({
      requestId: 'req-1',
      minuteBucket: 1_740_000_000,
      streamingTokens: 20,
      costCents: 0.15,
    });
    await db.upsertTokenDelta({
      requestId: 'req-1',
      minuteBucket: 1_740_000_000,
      streamingTokens: 10,
      costCents: 0.075,
    });
    await db.upsertTokenDelta({
      requestId: 'req-1',
      minuteBucket: 1_740_000_060,
      streamingTokens: 30,
      costCents: 0.2,
    });

    const totals = await db.getTotalDeltaTokensByConversation('conv-1');
    assert.equal(totals.totalStreamingTokens, 60);
    assert.ok(Math.abs(totals.totalCostCents - 0.425) < 0.0001);
    assert.equal(totals.minuteBuckets, 2);
  });

  it('stores latest context snapshot on delta rows and queries it by conversation', async () => {
    const db = await createDb();
    await db.upsertConversation('conv-1', 'prof-1', 1000);
    await db.upsertAgent({
      requestId: 'req-1',
      conversationId: 'conv-1',
      startedAt: 1000,
      isEof: false,
      profileId: 'prof-1',
    });

    await db.upsertTokenDelta({
      requestId: 'req-1',
      minuteBucket: 1_740_000_000,
      streamingTokens: 10,
      contextUsedTokens: 30_000,
      contextMaxTokens: 200_000,
      recordedAt: 1_740_000_010,
    });
    await db.upsertTokenDelta({
      requestId: 'req-1',
      minuteBucket: 1_740_000_060,
      streamingTokens: 5,
      contextUsedTokens: 45_000,
      contextMaxTokens: 200_000,
      recordedAt: 1_740_000_090,
    });

    const totals = await db.getTotalConversationTokens('conv-1');
    assert.equal(totals.latestContextUsedTokens, 45_000);
    assert.equal(totals.latestContextMaxTokens, 200_000);
  });

  it('stores turn_ended rows separately and queries by conversation', async () => {
    const db = await createDb();
    await db.upsertConversation('conv-1', 'prof-1', 1000);
    await db.upsertAgent({
      requestId: 'req-1',
      conversationId: 'conv-1',
      startedAt: 1000,
      isEof: false,
      profileId: 'prof-1',
    });

    await db.insertTurnEnded({
      requestId: 'req-1',
      inputTokens: 80,
      outputTokens: 120,
      recordedAt: 1001,
    });
    await db.insertTurnEnded({
      requestId: 'req-1',
      inputTokens: 40,
      outputTokens: 60,
      recordedAt: 1002,
    });

    const rows = await db.getTurnEndedByConversation('conv-1');
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.inputTokens, 40);
    assert.equal(rows[1]?.inputTokens, 80);
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

    await db.insertTurnEnded({
      requestId: 'req-1',
      inputTokens: 100,
      outputTokens: 200,
      totalCents: 1.25,
      recordedAt: 2000,
    });
    await db.insertTurnEnded({
      requestId: 'req-2',
      inputTokens: 50,
      outputTokens: 150,
      totalCents: 0.75,
      recordedAt: 3000,
    });

    const result = await db.getTotalConversationTokens('conv-1');
    assert.equal(result.agentCount, 2);
    assert.equal(result.totalInputTokens, 150);
    assert.equal(result.totalOutputTokens, 350);
    assert.equal(result.totalDeltaTokens, 0);
    assert.ok(Math.abs(result.totalTurnCostCents - 2) < 0.0001);
    assert.ok(result.models.includes('claude-sonnet'));
    assert.ok(result.models.includes('gpt-4'));
  });

  it('returns null for unknown agent tokens', async () => {
    const db = await createDb();
    const tokens = await db.getAgentTokens('missing');
    assert.equal(tokens, null);
  });
});
