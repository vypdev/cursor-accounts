import { spawn } from 'child_process';
import { validateStateDbPath } from '../utils/pathUtils';
import type { IDatabaseCleanupService } from '../domain/ports/IDatabaseCleanupService';
import { getSqlite3Binary } from '../auth/sqliteBinary';
import * as extensionLog from '../logging/extensionLog';
import type { IFileSystemService } from '../domain/ports/IFileSystemService';
import { buildDeepCleanBackupPath, DEEP_CLEAN_SQL } from './storageConstants';

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
    const backupPath = buildDeepCleanBackupPath(dbPath);
    await this.deps.fileSystem.copyFile(dbPath, backupPath);
    extensionLog.info(`[StorageCleanup] Backup created at ${backupPath}`);

    await this.runSqliteScript(dbPath, DEEP_CLEAN_SQL);

    const afterDbBytes = await this.deps.fileSystem.getFileSize(dbPath);
    const bytesReclaimed = Math.max(0, beforeDbBytes - afterDbBytes);

    return { backupPath, bytesReclaimed };
  }

  private runSqliteScript(dbPath: string, script: string): Promise<void> {
    const sqliteBinary = getSqlite3Binary(this.deps.extensionPath);

    return new Promise((resolve, reject) => {
      const child = spawn(sqliteBinary, [dbPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`SQLite script timed out for ${dbPath}`));
      }, 120_000);

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(stderr.trim() || `SQLite exited with code ${code ?? 'unknown'}`)
        );
      });

      child.stdin.write(script);
      child.stdin.end();
    });
  }
}
