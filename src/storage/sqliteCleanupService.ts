import { spawn } from 'child_process';
import * as path from 'path';
import { validateStateDbPath } from '../utils/pathUtils';
import type { IDatabaseCleanupService } from '../domain/ports/IDatabaseCleanupService';
import { getSqlite3Binary } from '../auth/sqliteBinary';
import * as extensionLog from '../logging/extensionLog';
import type { IFileSystemService } from '../domain/ports/IFileSystemService';
import {
  buildDeepCleanBackupPath,
  DEEP_CLEAN_BACKUP_NAME_PATTERN,
  DEEP_CLEAN_SQL,
} from './storageConstants';

export interface SqliteCleanupServiceDeps {
  extensionPath: string;
  fileSystem: IFileSystemService;
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
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

    // A raw copy of the main file can omit committed pages that still live in
    // a WAL sidecar. VACUUM INTO asks SQLite to create a consistent snapshot
    // of the logical database before any cleanup statements run.
    await this.runSqliteScript(
      dbPath,
      `VACUUM INTO ${sqlStringLiteral(backupPath)};`
    );
    extensionLog.info(`[StorageCleanup] Backup created at ${backupPath}`);

    try {
      await this.runSqliteScript(dbPath, DEEP_CLEAN_SQL);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Deep clean failed after backup ${backupPath}: ${message}`
      );
    }

    const afterDbBytes = await this.deps.fileSystem.getFileSize(dbPath);
    const bytesReclaimed = Math.max(0, beforeDbBytes - afterDbBytes);

    return { backupPath, bytesReclaimed };
  }

  async restoreDeepCleanBackup(
    dbPath: string,
    backupPath: string
  ): Promise<void> {
    validateStateDbPath(dbPath);
    validateStateDbPath(backupPath);

    const dbName = path.basename(dbPath);
    const backupName = path.basename(backupPath);
    if (
      path.dirname(backupPath) !== path.dirname(dbPath) ||
      !backupName.startsWith(`${dbName}.backup-`) ||
      !DEEP_CLEAN_BACKUP_NAME_PATTERN.test(backupName)
    ) {
      throw new Error(
        'Deep-clean restore requires a sibling timestamped backup for the same database'
      );
    }

    const backupStat = await this.deps.fileSystem.stat(backupPath);
    if (!backupStat?.isFile || backupStat.size === 0) {
      throw new Error(`Deep-clean backup not found or empty: ${backupPath}`);
    }

    const integrity = await this.runSqliteScript(
      backupPath,
      'PRAGMA integrity_check;'
    );
    if (integrity.trim() !== 'ok') {
      throw new Error(`Deep-clean backup failed integrity check: ${backupPath}`);
    }

    await this.runSqliteScript(
      dbPath,
      `.restore main ${sqlStringLiteral(backupPath)}`
    );

    const restoredIntegrity = await this.runSqliteScript(
      dbPath,
      'PRAGMA integrity_check;'
    );
    if (restoredIntegrity.trim() !== 'ok') {
      throw new Error(`Restored database failed integrity check: ${dbPath}`);
    }
  }

  private runSqliteScript(dbPath: string, script: string): Promise<string> {
    const sqliteBinary = getSqlite3Binary(this.deps.extensionPath);

    return new Promise((resolve, reject) => {
      const child = spawn(sqliteBinary, [dbPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
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
          resolve(stdout);
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
