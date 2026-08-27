import * as fs from 'fs/promises';
import * as path from 'path';
import * as extensionLog from '../logging/extensionLog';
import { isNotFoundError } from '../utils/fileSystemErrors';
import type { DatabaseMigrator } from './databaseMigrations';
import type { SqliteExecutor } from './sqliteExecutor';

export interface EfficiencyDatabaseLifecycleDeps {
  dbPath: string;
  executor: SqliteExecutor;
  migrator: DatabaseMigrator;
}

interface RecoverySnapshot {
  directory: string;
  sidecars: Map<string, string>;
}

/** Owns schema initialization, corruption recovery, and database-file lifecycle. */
export class EfficiencyDatabaseLifecycle {
  constructor(private readonly deps: EfficiencyDatabaseLifecycleDeps) {}

  async initialize(): Promise<void> {
    const exists = await this.deps.executor.dbExists();

    if (!exists) {
      await this.createFresh();
      return;
    }

    const recoverySnapshot = await this.createRecoverySnapshot();

    try {
      const migrations = await this.deps.migrator.loadMigrations();
      const currentVersion = await this.deps.migrator.getCurrentVersion();
      const targetVersion = this.deps.migrator.getTargetVersion(migrations);

      if (currentVersion > targetVersion) {
        extensionLog.warn(
          `[EfficiencyDatabase] DB version ${currentVersion} is newer than extension version ${targetVersion}. Using as-is.`
        );
        return;
      }

      if (currentVersion < targetVersion) {
        const result = await this.deps.migrator.migrate();
        if (!result.success) {
          throw new Error(`Migration failed: ${result.error ?? 'unknown'}`);
        }
        extensionLog.info(
          `[EfficiencyDatabase] Migrated from v${result.fromVersion} to v${result.toVersion}`
        );
      }

      const validation = await this.deps.migrator.validate();
      if (!validation.valid) {
        throw new Error(`Schema validation failed: ${validation.error}`);
      }
    } catch (error) {
      extensionLog.error(
        `[EfficiencyDatabase] Initialization failed: ${extensionLog.formatError(error)}. Recreating database.`
      );
      await this.fallbackRecreate(recoverySnapshot);
    } finally {
      await this.removeRecoverySnapshot(recoverySnapshot);
    }
  }

  private async createRecoverySnapshot(): Promise<RecoverySnapshot | null> {
    let directory: string;
    try {
      directory = await fs.mkdtemp(`${this.deps.dbPath}.recovery-`);
    } catch (error) {
      extensionLog.warn(
        `[EfficiencyDatabase] Could not create a recovery snapshot: ${extensionLog.formatError(error)}`
      );
      return null;
    }

    const sidecars = new Map<string, string>();
    for (const suffix of ['-wal', '-shm']) {
      const sourcePath = `${this.deps.dbPath}${suffix}`;
      const snapshotPath = path.join(directory, `database${suffix}`);
      try {
        await fs.copyFile(sourcePath, snapshotPath);
        sidecars.set(suffix, snapshotPath);
      } catch (error) {
        if (!isNotFoundError(error)) {
          extensionLog.warn(
            `[EfficiencyDatabase] Could not snapshot ${sourcePath}: ${extensionLog.formatError(error)}`
          );
        }
      }
    }

    return { directory, sidecars };
  }

  private async removeRecoverySnapshot(
    snapshot: RecoverySnapshot | null
  ): Promise<void> {
    if (!snapshot) {
      return;
    }
    await fs
      .rm(snapshot.directory, { recursive: true, force: true })
      .catch((error) => {
        extensionLog.warn(
          `[EfficiencyDatabase] Could not remove recovery snapshot: ${extensionLog.formatError(error)}`
        );
      });
  }

  private async createFresh(): Promise<void> {
    const migrations = await this.deps.migrator.loadMigrations();
    const first = migrations[0];
    if (!first) {
      throw new Error('No migration files found');
    }
    await this.deps.migrator.applyInitialMigration(first);
    extensionLog.info(
      `[EfficiencyDatabase] Created fresh database v${first.version} using ${first.filename}`
    );
  }

  private async fallbackRecreate(
    recoverySnapshot: RecoverySnapshot | null
  ): Promise<void> {
    const timestamp = Date.now();
    const backupPath = `${this.deps.dbPath}.corrupted-${timestamp}`;

    const databasePreserved = await this.preserveCorruptedArtifact(
      this.deps.dbPath,
      backupPath,
      'corrupted efficiency database'
    );
    if (databasePreserved) {
      extensionLog.info(
        `[EfficiencyDatabase] Corrupted DB backed up to ${backupPath}`
      );
    }

    // WAL and shared-memory sidecars belong to the same database snapshot.
    // Moving only the main file and deleting these artifacts can discard
    // committed WAL pages and makes the backup impossible to restore.
    for (const suffix of ['-wal', '-shm']) {
      const preserved = await this.preserveCorruptedArtifact(
        `${this.deps.dbPath}${suffix}`,
        `${backupPath}${suffix}`,
        'corrupted efficiency database sidecar'
      );
      if (!preserved) {
        await this.preserveRecoverySnapshot(
          recoverySnapshot,
          suffix,
          `${backupPath}${suffix}`
        );
      }
    }

    await this.createFresh();
  }

  private async preserveRecoverySnapshot(
    snapshot: RecoverySnapshot | null,
    suffix: string,
    backupPath: string
  ): Promise<void> {
    const snapshotPath = snapshot?.sidecars.get(suffix);
    if (!snapshotPath) {
      return;
    }
    await fs.copyFile(snapshotPath, backupPath);
  }

  private async preserveCorruptedArtifact(
    sourcePath: string,
    backupPath: string,
    description: string
  ): Promise<boolean> {
    try {
      await fs.rename(sourcePath, backupPath);
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw new Error(
        `Cannot preserve ${description} at ${backupPath}: ${extensionLog.formatError(error)}`
      );
    }
  }

  async getDatabaseSize(): Promise<number> {
    let total = 0;
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        const stat = await fs.stat(`${this.deps.dbPath}${suffix}`);
        total += stat.size;
      } catch {
        // Missing sidecars are normal after a checkpoint or first creation.
      }
    }
    return total;
  }

  async destroyDatabase(): Promise<void> {
    await fs.unlink(this.deps.dbPath).catch(() => {});
    await fs.unlink(`${this.deps.dbPath}-wal`).catch(() => {});
    await fs.unlink(`${this.deps.dbPath}-shm`).catch(() => {});
  }
}
