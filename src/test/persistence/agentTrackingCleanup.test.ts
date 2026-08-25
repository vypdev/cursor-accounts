import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { IDatabaseConnectionManager } from '../../domain/ports/IDatabaseConnectionManager';
import type { IAgentTrackingRepository } from '../../domain/ports/IAgentTrackingRepository';
import { BetterSqliteAgentTrackingRepository } from '../../persistence/betterSqlite/betterSqliteAgentTrackingRepository';
import { BetterSqliteConnectionManager } from '../../persistence/betterSqlite/betterSqliteConnectionManager';

const extensionPath = path.join(__dirname, '..', '..', '..');

async function createRepository(
  dbPath: string,
  connectionManager: IDatabaseConnectionManager
): Promise<IAgentTrackingRepository> {
  const repository = new BetterSqliteAgentTrackingRepository(
    connectionManager,
    dbPath,
    extensionPath
  );
  await repository.initialize();
  return repository;
}

async function seedConversation(
  repository: IAgentTrackingRepository,
  conversationId: string,
  requestId: string,
  timestamp: number,
  profileId = 'profile-1'
): Promise<void> {
  await repository.upsertConversation(
    conversationId,
    profileId,
    timestamp
  );
  await repository.upsertAgent({
    requestId,
    conversationId,
    startedAt: timestamp,
    isEof: true,
    profileId,
  });
  await repository.insertTokenSnapshot({
    requestId,
    tokenType: 'token_details',
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    recordedAt: timestamp,
    eventKey: `snapshot-${requestId}`,
  });
  await repository.upsertTokenDelta({
    requestId,
    minuteBucket: timestamp,
    streamingTokens: 5,
    costCents: 2,
    recordedAt: timestamp,
    eventKey: `delta-${requestId}`,
  });
  await repository.insertTurnEnded({
    requestId,
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    recordedAt: timestamp,
    eventKey: `turn-${requestId}`,
  });
}

async function countRows(
  connectionManager: BetterSqliteConnectionManager,
  dbPath: string,
  table: string,
  where: string,
  parameter: string
): Promise<number> {
  const connection = await connectionManager.getConnection(dbPath);
  const row = connection.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`,
    parameter
  );
  return row?.count ?? 0;
}

describe('Agent tracking retention cleanup', () => {
  let tempDir = '';
  let connectionManager: BetterSqliteConnectionManager | undefined;

  afterEach(async () => {
    await connectionManager?.closeAllConnections();
    connectionManager = undefined;
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('deletes only eligible conversations and all dependent tracking rows', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-cleanup-'));
    connectionManager = new BetterSqliteConnectionManager();
    const dbPath = path.join(tempDir, 'efficiency.db');
    const repository = await createRepository(dbPath, connectionManager);

    await seedConversation(repository, 'old-conversation', 'old-request', 100);
    await seedConversation(repository, 'new-conversation', 'new-request', 300);
    await seedConversation(
      repository,
      'other-profile-conversation',
      'other-profile-request',
      100,
      'profile-2'
    );

    assert.equal(
      await repository.deleteOldConversations('profile-1', 200),
      1
    );
    assert.equal(
      await repository.deleteOldConversations('profile-1', 200),
      0
    );
    assert.equal(
      await countRows(
        connectionManager,
        dbPath,
        'conversations',
        'conversation_id = ?',
        'other-profile-conversation'
      ),
      1
    );

    assert.equal(
      await countRows(
        connectionManager,
        dbPath,
        'conversations',
        'conversation_id = ?',
        'old-conversation'
      ),
      0,
      'conversations should be deleted for the old conversation'
    );
    for (const table of [
      'agents',
      'agent_tokens',
      'agent_tokens_delta',
      'agent_tokens_delta_events',
      'agent_turn_ended',
    ]) {
      assert.equal(
        await countRows(
          connectionManager,
          dbPath,
          table,
          'request_id = ?',
          'old-request'
        ),
        0,
        `${table} should be deleted for the old conversation`
      );
    }
    assert.equal(
      await countRows(
        connectionManager,
        dbPath,
        'conversations',
        'conversation_id = ?',
        'new-conversation'
      ),
      1
    );
    assert.equal(
      await countRows(
        connectionManager,
        dbPath,
        'agents',
        'request_id = ?',
        'new-request'
      ),
      1
    );
  });

  it('rolls back every dependent deletion when the transaction fails', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-cleanup-'));
    connectionManager = new BetterSqliteConnectionManager();
    const dbPath = path.join(tempDir, 'efficiency.db');
    const repository = await createRepository(dbPath, connectionManager);
    await seedConversation(repository, 'old-conversation', 'old-request', 100);

    const connection = await connectionManager.getConnection(dbPath);
    connection.run(`
      CREATE TRIGGER prevent_agent_cleanup
      BEFORE DELETE ON agents
      BEGIN
        SELECT RAISE(ABORT, 'retention failure');
      END
    `);

    await assert.rejects(
      repository.deleteOldConversations('profile-1', 200),
      /Transaction failed and was rolled back/
    );

    assert.equal(
      await countRows(
        connectionManager,
        dbPath,
        'conversations',
        'conversation_id = ?',
        'old-conversation'
      ),
      1
    );
    for (const table of [
      'agents',
      'agent_tokens',
      'agent_tokens_delta',
      'agent_tokens_delta_events',
      'agent_turn_ended',
    ]) {
      assert.equal(
        await countRows(
          connectionManager,
          dbPath,
          table,
          'request_id = ?',
          'old-request'
        ),
        1,
        `${table} should be restored after rollback`
      );
    }
  });
});
