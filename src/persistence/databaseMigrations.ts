import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as extensionLog from '../logging/extensionLog';
import {
  resolveMigrationsDir,
  SqliteExecutor,
} from './sqliteExecutor';
import type {
  MigrationDefinition,
  MigrationResult,
  ValidationResult,
} from './types';
import { EXPECTED_SCHEMA_TABLES } from './types';

const SCHEMA_VERSION_KEY = 'schema_version';

export class DatabaseMigrator {
  private readonly executor: SqliteExecutor;
  private readonly migrationsDir: string;
  private migrationsCache?: MigrationDefinition[];

  constructor(
    dbPath: string,
    extensionPath: string
  ) {
    this.executor = new SqliteExecutor(dbPath, extensionPath);
    this.migrationsDir = resolveMigrationsDir(extensionPath);
  }

  parseVersion(filename: string): number {
    const match = filename.match(/^(\d+)_/);
    if (!match?.[1]) {
      throw new Error(
        `Invalid migration filename: ${filename}. Must start with NNN_ (e.g., 001_initial_schema.sql)`
      );
    }
    return parseInt(match[1], 10);
  }

  async loadMigrations(): Promise<MigrationDefinition[]> {
    if (this.migrationsCache) {
      return this.migrationsCache;
    }

    let entries: string[];
    try {
      entries = await fs.readdir(this.migrationsDir);
    } catch (error) {
      throw new Error(
        `Migrations directory not found at ${this.migrationsDir}: ${extensionLog.formatError(error)}`
      );
    }

    const sqlFiles = entries.filter((f) => f.endsWith('.sql')).sort();

    const migrations = await Promise.all(
      sqlFiles.map(async (file) => {
        const version = this.parseVersion(file);
        const sql = await fs.readFile(
          path.join(this.migrationsDir, file),
          'utf-8'
        );
        return {
          version,
          name: file.replace(/^\d+_/, '').replace(/\.sql$/, ''),
          filename: file,
          sql: sql.trim(),
        };
      })
    );

    if (migrations.length === 0) {
      throw new Error(`No migration files found in ${this.migrationsDir}`);
    }

    this.migrationsCache = migrations;
    return migrations;
  }

  getTargetVersion(migrations: MigrationDefinition[]): number {
    return migrations[migrations.length - 1]?.version ?? 0;
  }

  async getCurrentVersion(): Promise<number> {
    const exists = await this.executor.dbExists();
    if (!exists) {
      return 0;
    }

    try {
      const metadataTable = this.executor.queryRows<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'database_metadata' LIMIT 1;`
      );
      if (metadataTable.length === 0) {
        return 0;
      }

      const rows = this.executor.queryRows<{ value: string }>(
        `SELECT value FROM database_metadata WHERE key = '${SCHEMA_VERSION_KEY}' LIMIT 1;`
      );
      const raw = rows[0]?.value;
      const parsed = raw !== undefined ? parseInt(String(raw), 10) : 0;
      return Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  }

  async needsMigration(): Promise<boolean> {
    const migrations = await this.loadMigrations();
    const current = await this.getCurrentVersion();
    const target = this.getTargetVersion(migrations);
    return current < target;
  }

  private versionUpsertSql(version: number): string {
    const now = Math.floor(Date.now() / 1000);
    return `
INSERT INTO database_metadata (key, value, updated_at)
VALUES ('${SCHEMA_VERSION_KEY}', '${version}', ${now})
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;
`.trim();
  }

  async migrate(): Promise<MigrationResult> {
    const migrations = await this.loadMigrations();
    const currentVersion = await this.getCurrentVersion();
    const targetVersion = this.getTargetVersion(migrations);
    const migrationsApplied: string[] = [];

    if (currentVersion >= targetVersion) {
      return {
        success: true,
        fromVersion: currentVersion,
        toVersion: currentVersion,
        migrationsApplied,
      };
    }

    const pending = migrations.filter((m) => m.version > currentVersion);
    if (pending.length === 0) {
      return {
        success: true,
        fromVersion: currentVersion,
        toVersion: currentVersion,
        migrationsApplied,
      };
    }

    const scriptParts = ['BEGIN IMMEDIATE;'];

    try {
      for (const migration of pending) {
        extensionLog.info(
          `[DatabaseMigrator] Applying migration ${migration.version}: ${migration.filename}`
        );
        scriptParts.push(migration.sql);
        scriptParts.push(this.versionUpsertSql(migration.version));
        migrationsApplied.push(migration.filename);
      }
      scriptParts.push('COMMIT;');

      await this.executor.runScript(scriptParts.join('\n'));

      return {
        success: true,
        fromVersion: currentVersion,
        toVersion: targetVersion,
        migrationsApplied,
      };
    } catch (error) {
      return {
        success: false,
        fromVersion: currentVersion,
        toVersion: currentVersion,
        migrationsApplied,
        error: extensionLog.formatError(error),
      };
    }
  }

  async validate(): Promise<ValidationResult> {
    const expectedTables = [...EXPECTED_SCHEMA_TABLES];

    try {
      const rows = this.executor.queryRows<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`
      );
      const actualTables = rows.map((r) => r.name);
      const missingTables = expectedTables.filter(
        (t) => !actualTables.includes(t)
      );

      if (missingTables.length > 0) {
        return {
          valid: false,
          expectedTables,
          missingTables,
          error: `Missing tables: ${missingTables.join(', ')}`,
        };
      }

      return { valid: true, expectedTables, missingTables: [] };
    } catch (error) {
      return {
        valid: false,
        expectedTables,
        missingTables: expectedTables,
        error: extensionLog.formatError(error),
      };
    }
  }

  async applyInitialMigration(migration: MigrationDefinition): Promise<void> {
    await this.executor.runScript(migration.sql);
  }

  getExecutor(): SqliteExecutor {
    return this.executor;
  }

  getMigrationsDir(): string {
    return this.migrationsDir;
  }

  migrationsDirExists(): boolean {
    return fsSync.existsSync(this.migrationsDir);
  }
}
