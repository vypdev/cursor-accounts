import { execFileSync } from 'child_process';
import type { IDatabaseCleanupService } from '../domain/ports/IDatabaseCleanupService';
import { getSqlite3Binary } from '../auth/sqliteBinary';
import { validateStateDbPath } from '../auth/tokenReader';
import * as extensionLog from '../logging/extensionLog';
import type { IFileSystemService } from '../domain/ports/IFileSystemService';
import { DEEP_CLEAN_SQL } from './storageConstants';

export interface SqliteCleanupServiceDeps {
  extensionPath: string;
  fileSystem: IFileSystemService;
}

/**
 * Runs SQLite maintenance scripts against a profile `state.vscdb`.
 * Requires the profile to be closed so the database is not locked.
 */
export class SqliteCleanupService implements IDatabaseCleanupService {
  constructor(private readonly deps: SqliteCleanupServiceDeps) {}

  /**
   * Compact the database file and truncate WAL sidecar files.
   * @remarks Safe when the profile is not running; does not delete chat rows.
   */
  async vacuum(dbPath: string): Promise<void> {
    validateStateDbPath(dbPath);
    await this.runSqliteScript(
      dbPath,
      'VACUUM;\nPRAGMA wal_checkpoint(TRUNCATE);'
    );
  }

  /**
   * Delete composer/agent KV rows, vacuum, and report space reclaimed.
   * @remarks Creates a timestamped `.backup-<ms>` copy before modifying the DB.
   */
  async deepClean(dbPath: string): Promise<{
    backupPath: string;
    bytesReclaimed: number;
  }> {
    validateStateDbPath(dbPath);

    const beforeDbBytes = await this.deps.fileSystem.getFileSize(dbPath);
    const backupPath = `${dbPath}.backup-${Date.now()}`;
    await this.deps.fileSystem.copyFile(dbPath, backupPath);
    extensionLog.info(`[StorageCleanup] Backup created at ${backupPath}`);

    await this.runSqliteScript(dbPath, DEEP_CLEAN_SQL);

    const afterDbBytes = await this.deps.fileSystem.getFileSize(dbPath);
    const bytesReclaimed = Math.max(0, beforeDbBytes - afterDbBytes);

    return { backupPath, bytesReclaimed };
  }

  private runSqliteScript(dbPath: string, script: string): void {
    const sqliteBinary = getSqlite3Binary(this.deps.extensionPath);
    execFileSync(sqliteBinary, [dbPath], {
      input: script,
      encoding: 'utf-8',
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
  }
}
