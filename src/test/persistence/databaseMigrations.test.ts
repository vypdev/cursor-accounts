import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { getSqlite3Binary } from '../../auth/sqliteBinary';
import { DatabaseMigrator } from '../../persistence/databaseMigrations';

const extensionPath = path.join(__dirname, '..', '..', '..');

function runSqlite(dbPath: string, sql: string): string {
  return execFileSync(getSqlite3Binary(extensionPath), ['-json', dbPath, sql], {
    encoding: 'utf8',
  });
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
    assert.equal(result.toVersion, 4);
    assert.ok(result.migrationsApplied.includes('001_initial_schema.sql'));
    assert.ok(result.migrationsApplied.includes('002_agent_tracking.sql'));
    assert.ok(result.migrationsApplied.includes('003_agent_turn_tracking.sql'));
    assert.ok(result.migrationsApplied.includes('004_cleanup_corrupt_tokens.sql'));

    const validation = await migrator.validate();
    assert.equal(validation.valid, true);

    const version = await migrator.getCurrentVersion();
    assert.equal(version, 4);
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
    const migrations = await migrator.loadMigrations();
    const throughV3 = migrations.filter((m) => m.version <= 3);

    for (const migration of throughV3) {
      await migrator.getExecutor().runScript(migration.sql);
      await migrator.getExecutor().runStatement(
        `INSERT INTO database_metadata (key, value, updated_at)
         VALUES ('schema_version', '${migration.version}', ${Math.floor(Date.now() / 1000)})
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`
      );
    }

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
