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
    assert.equal(result.toVersion, 2);
    assert.ok(result.migrationsApplied.includes('001_initial_schema.sql'));
    assert.ok(result.migrationsApplied.includes('002_agent_tracking.sql'));

    const validation = await migrator.validate();
    assert.equal(validation.valid, true);

    const version = await migrator.getCurrentVersion();
    assert.equal(version, 2);
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
});
