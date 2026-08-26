import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { getSqlite3Binary } from '../../auth/sqliteBinary';
import { BetterSqliteConnectionManager } from '../../persistence/betterSqlite/betterSqliteConnectionManager';
import { BetterSqliteAgentTrackingSchemaInitializer } from '../../persistence/betterSqlite/betterSqliteAgentTrackingSchemaInitializer';
import { DatabaseMigrator } from '../../persistence/databaseMigrations';

const extensionPath = path.join(__dirname, '..', '..', '..');

function runSqlite(dbPath: string, sql: string): string {
  return execFileSync(getSqlite3Binary(extensionPath), ['-json', dbPath, sql], {
    encoding: 'utf8',
  });
}

async function applyMigrationsThrough(
  migrator: DatabaseMigrator,
  version: number
): Promise<void> {
  const migrations = await migrator.loadMigrations();
  for (const migration of migrations.filter((item) => item.version <= version)) {
    await migrator.getExecutor().runScript(migration.sql);
    await migrator.getExecutor().runStatement(
      `INSERT INTO database_metadata (key, value, updated_at)
       VALUES ('schema_version', '${migration.version}', ${Math.floor(Date.now() / 1000)})
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`
    );
  }
}

describe('DatabaseMigrator', () => {
  let tempDir = '';

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('loads migrations from SQL files', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-migrate-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const migrator = new DatabaseMigrator(dbPath, extensionPath);

    assert.ok(migrator.migrationsDirExists());
    const migrations = await migrator.loadMigrations();
    assert.ok(migrations.length >= 1);
    assert.equal(migrations[0]?.version, 1);
    assert.match(migrations[0]?.filename ?? '', /^001_/);
  });

  it('creates schema on fresh database via migrate from version 0', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-migrate-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const migrator = new DatabaseMigrator(dbPath, extensionPath);

    const result = await migrator.migrate();
    assert.equal(result.success, true);
    assert.equal(result.toVersion, 10);
    assert.ok(result.migrationsApplied.includes('001_initial_schema.sql'));
    assert.ok(result.migrationsApplied.includes('002_agent_tracking.sql'));
    assert.ok(result.migrationsApplied.includes('003_agent_turn_tracking.sql'));
    assert.ok(result.migrationsApplied.includes('004_cleanup_corrupt_tokens.sql'));
    assert.ok(result.migrationsApplied.includes('005_agent_turn_ended_table.sql'));
    assert.ok(result.migrationsApplied.includes('006_agent_tokens_delta_cost.sql'));
    assert.ok(result.migrationsApplied.includes('007_agent_tokens_delta_context.sql'));
    assert.ok(result.migrationsApplied.includes('008_agent_tokens_delta_table.sql'));
    assert.ok(result.migrationsApplied.includes('009_agent_event_idempotency.sql'));
    assert.ok(result.migrationsApplied.includes('010_cost_provenance.sql'));

    const validation = await migrator.validate();
    assert.equal(validation.valid, true);

    const version = await migrator.getCurrentVersion();
    assert.equal(version, 10);
  });

  it('does not reapply migrations when already at target version', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-migrate-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const migrator = new DatabaseMigrator(dbPath, extensionPath);

    await migrator.migrate();
    const second = await migrator.migrate();
    assert.equal(second.success, true);
    assert.equal(second.migrationsApplied.length, 0);
  });

  it('adds cost provenance columns with safe defaults to legacy rows', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-migrate-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const migrator = new DatabaseMigrator(dbPath, extensionPath);

    await applyMigrationsThrough(migrator, 9);
    runSqlite(
      dbPath,
      `INSERT INTO conversations (conversation_id, profile_id, created_at, last_activity)
       VALUES ('legacy-conv', 'legacy-profile', 1000, 1000);
       INSERT INTO agents (request_id, conversation_id, started_at, is_eof, profile_id)
       VALUES ('legacy-request', 'legacy-conv', 1000, 0, 'legacy-profile');
       INSERT INTO agent_turn_ended (request_id, input_tokens, output_tokens, recorded_at)
       VALUES ('legacy-request', 1, 2, 1000);
       INSERT INTO agent_tokens_delta (request_id, conversation_id, minute_bucket)
       VALUES ('legacy-request', 'legacy-conv', 960);
       INSERT INTO agent_tokens_delta_events (
         event_key, request_id, conversation_id, minute_bucket, delta_tokens
       ) VALUES ('legacy-event', 'legacy-request', 'legacy-conv', 960, 1);`
    );

    const result = await migrator.migrate();
    assert.equal(result.success, true);
    assert.equal(result.toVersion, 10);

    const rows = JSON.parse(
      runSqlite(
        dbPath,
        `SELECT
           (SELECT cost_source FROM agent_turn_ended WHERE request_id = 'legacy-request') AS turn_source,
           (SELECT pricing_snapshot_version FROM agent_turn_ended WHERE request_id = 'legacy-request') AS turn_version,
           (SELECT cost_source FROM agent_tokens_delta WHERE request_id = 'legacy-request') AS delta_source,
           (SELECT pricing_snapshot_version FROM agent_tokens_delta WHERE request_id = 'legacy-request') AS delta_version,
           (SELECT cost_source FROM agent_tokens_delta_events WHERE event_key = 'legacy-event') AS event_source,
           (SELECT pricing_snapshot_version FROM agent_tokens_delta_events WHERE event_key = 'legacy-event') AS event_version;`
      )
    ) as Array<Record<string, string | null>>;

    assert.deepEqual(rows[0], {
      turn_source: 'unknown',
      turn_version: null,
      delta_source: 'unknown',
      delta_version: null,
      event_source: 'unknown',
      event_version: null,
    });
  });

  it('rolls back a failed migration and retries cleanly after the conflict is removed', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-migrate-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const migrator = new DatabaseMigrator(dbPath, extensionPath);

    await applyMigrationsThrough(migrator, 8);
    runSqlite(
      dbPath,
      'CREATE TABLE agent_tokens_delta_events (conflicting_column TEXT);'
    );

    const failed = await migrator.migrate();
    assert.equal(failed.success, false);
    assert.equal(failed.fromVersion, 8);
    assert.equal(failed.toVersion, 8);
    assert.equal(await migrator.getCurrentVersion(), 8);

    const columns = JSON.parse(
      runSqlite(dbPath, 'PRAGMA table_info(agent_tokens);')
    ) as Array<{ name: string }>;
    assert.equal(
      columns.some((column) => column.name === 'event_key'),
      false,
      'Failed migration must not leave partially added columns'
    );

    runSqlite(dbPath, 'DROP TABLE agent_tokens_delta_events;');
    const retried = await migrator.migrate();
    assert.equal(retried.success, true);
    assert.equal(retried.fromVersion, 8);
    assert.equal(retried.toVersion, 10);
    assert.equal(await migrator.getCurrentVersion(), 10);
  });

  it('fails schema initialization when migration fails instead of accepting partial state', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-migrate-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const migrator = new DatabaseMigrator(dbPath, extensionPath);
    await applyMigrationsThrough(migrator, 8);
    runSqlite(
      dbPath,
      'CREATE TABLE agent_tokens_delta_events (conflicting_column TEXT);'
    );

    const manager = new BetterSqliteConnectionManager();
    try {
      const initializer = new BetterSqliteAgentTrackingSchemaInitializer(
        manager,
        dbPath,
        extensionPath
      );
      await assert.rejects(
        () => initializer.initialize(),
        /Agent tracking database migration failed/
      );
    } finally {
      await manager.closeAllConnections();
    }
  });

  it('rejects invalid migration filenames', () => {
    tempDir = path.join(os.tmpdir(), 'unused');
    const migrator = new DatabaseMigrator(
      path.join(os.tmpdir(), 'x.db'),
      extensionPath
    );
    assert.throws(
      () => migrator.parseVersion('invalid.sql'),
      /Invalid migration filename/
    );
  });

  it('validates missing tables as invalid schema', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-migrate-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    runSqlite(
      dbPath,
      `CREATE TABLE unrelated (id INTEGER PRIMARY KEY);`
    );

    const migrator = new DatabaseMigrator(dbPath, extensionPath);
    const validation = await migrator.validate();
    assert.equal(validation.valid, false);
    assert.ok(validation.missingTables.includes('prompt_events'));
  });

  it('migration 004 removes corrupt turn_ended token rows', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-migrate-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const migrator = new DatabaseMigrator(dbPath, extensionPath);
    await applyMigrationsThrough(migrator, 3);

    runSqlite(
      dbPath,
      `INSERT INTO conversations (conversation_id, profile_id, created_at, last_activity)
       VALUES ('conv-corrupt', 'prof-1', 1000, 1000);`
    );
    runSqlite(
      dbPath,
      `INSERT INTO agents (request_id, conversation_id, started_at, is_eof, profile_id)
       VALUES ('req-corrupt', 'conv-corrupt', 1000, 0, 'prof-1');`
    );
    runSqlite(
      dbPath,
      `INSERT INTO agent_tokens (
         request_id, token_type, input_tokens, output_tokens, recorded_at
       ) VALUES (
         'req-corrupt', 'turn_ended', 314202530873276, 200, 1000
       );`
    );

    const result = await migrator.migrate();
    assert.equal(result.success, true);
    assert.ok(
      result.migrationsApplied.includes('004_cleanup_corrupt_tokens.sql')
    );

    const rows = JSON.parse(
      runSqlite(
        dbPath,
        `SELECT COUNT(*) AS count FROM agent_tokens WHERE request_id = 'req-corrupt';`
      )
    ) as Array<{ count: number }>;
    assert.equal(rows[0]?.count, 0);
  });
});
