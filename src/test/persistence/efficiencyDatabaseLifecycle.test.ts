import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { EfficiencyDatabaseLifecycle } from '../../persistence/efficiencyDatabaseLifecycle';
import type { DatabaseMigrator } from '../../persistence/databaseMigrations';
import type { MigrationDefinition, MigrationResult } from '../../persistence/types';
import type { SqliteExecutor } from '../../persistence/sqliteExecutor';

function migration(version = 1): MigrationDefinition {
  return {
    version,
    name: 'initial schema',
    filename: `${String(version).padStart(3, '0')}_initial_schema.sql`,
    sql: 'CREATE TABLE example (id INTEGER);',
  };
}

function createLifecycle(
  dbPath: string,
  options: {
    exists?: boolean;
    currentVersion?: number;
    targetVersion?: number;
    migrationResult?: MigrationResult;
    migrations?: MigrationDefinition[];
    removeSidecarsOnMigrate?: boolean;
  } = {}
) {
  const calls = {
    appliedMigration: 0,
    migrated: 0,
    validated: 0,
  };
  const migrations = options.migrations ?? [migration(options.targetVersion ?? 1)];
  const executor = {
    dbExists: async () => options.exists ?? true,
  } as unknown as SqliteExecutor;
  const migrator = {
    loadMigrations: async () => migrations,
    getCurrentVersion: async () => options.currentVersion ?? 0,
    getTargetVersion: () => options.targetVersion ?? migrations.at(-1)?.version ?? 0,
    migrate: async () => {
      calls.migrated += 1;
      if (options.removeSidecarsOnMigrate) {
        await fs.unlink(`${dbPath}-wal`).catch(() => {});
        await fs.unlink(`${dbPath}-shm`).catch(() => {});
      }
      return (
        options.migrationResult ?? {
          success: true,
          fromVersion: options.currentVersion ?? 0,
          toVersion: options.targetVersion ?? migrations.at(-1)?.version ?? 0,
          migrationsApplied: migrations.map((item) => item.filename),
        }
      );
    },
    validate: async () => {
      calls.validated += 1;
      return { valid: true, expectedTables: [], missingTables: [] };
    },
    applyInitialMigration: async () => {
      calls.appliedMigration += 1;
      await fs.writeFile(dbPath, 'fresh database');
    },
  } as unknown as DatabaseMigrator;

  return {
    calls,
    lifecycle: new EfficiencyDatabaseLifecycle({
      dbPath,
      executor,
      migrator,
    }),
  };
}

describe('EfficiencyDatabaseLifecycle', () => {
  let tempDir = '';

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('creates a fresh database without probing a missing file', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-lifecycle-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const { lifecycle, calls } = createLifecycle(dbPath, { exists: false });

    await lifecycle.initialize();

    assert.equal(calls.appliedMigration, 1);
    assert.equal(calls.migrated, 0);
    assert.equal(await fs.readFile(dbPath, 'utf8'), 'fresh database');
  });

  it('migrates an existing database and validates the resulting schema', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-lifecycle-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    await fs.writeFile(dbPath, 'existing database');
    const { lifecycle, calls } = createLifecycle(dbPath, {
      currentVersion: 0,
      targetVersion: 2,
      migrations: [migration(1), migration(2)],
    });

    await lifecycle.initialize();

    assert.equal(calls.migrated, 1);
    assert.equal(calls.validated, 1);
    const entries = await fs.readdir(tempDir);
    assert.equal(entries.some((entry) => entry.includes('.recovery-')), false);
  });

  it('preserves sidecars when initialization fails after SQLite has probed the database', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-lifecycle-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    await fs.writeFile(dbPath, 'corrupted database');
    await fs.writeFile(`${dbPath}-wal`, 'original WAL');
    await fs.writeFile(`${dbPath}-shm`, 'original SHM');
    const { lifecycle } = createLifecycle(dbPath, {
      migrationResult: {
        success: false,
        fromVersion: 0,
        toVersion: 0,
        migrationsApplied: [],
        error: 'migration failed',
      },
      removeSidecarsOnMigrate: true,
    });

    await lifecycle.initialize();

    const backupName = (await fs.readdir(tempDir)).find((entry) =>
      /^efficiency\.db\.corrupted-\d+$/.test(entry)
    );
    assert.ok(backupName);
    assert.equal(
      await fs.readFile(path.join(tempDir, `${backupName}-wal`), 'utf8'),
      'original WAL'
    );
    assert.equal(
      await fs.readFile(path.join(tempDir, `${backupName}-shm`), 'utf8'),
      'original SHM'
    );
    assert.equal(
      (await fs.readdir(tempDir)).some((entry) => entry.includes('.recovery-')),
      false
    );
  });

  it('accounts for sidecars and removes all database artifacts on destroy', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eff-lifecycle-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    await fs.writeFile(dbPath, 'db');
    await fs.writeFile(`${dbPath}-wal`, 'wal');
    await fs.writeFile(`${dbPath}-shm`, 'shm');
    const { lifecycle } = createLifecycle(dbPath);

    assert.equal(await lifecycle.getDatabaseSize(), 8);
    await lifecycle.destroyDatabase();

    await assert.rejects(fs.access(dbPath));
    await assert.rejects(fs.access(`${dbPath}-wal`));
    await assert.rejects(fs.access(`${dbPath}-shm`));
  });
});
