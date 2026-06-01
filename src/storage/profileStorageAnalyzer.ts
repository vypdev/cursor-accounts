import * as path from 'path';
import type { StorageBreakdown } from '@cursor-accounts/types';
import type { IFileSystemService } from '../domain/ports/IFileSystemService';
import type { IProfileStorageAnalyzer } from '../domain/ports/IProfileStorageAnalyzer';
import { getProfileStateDbPath } from '../auth/cursorPaths';
import { validateUserDataPath } from '../utils/pathUtils';
import { EDITOR_CACHE_DIRS } from './storageConstants';

/** Format byte counts for display (e.g. 1536 -> "1.5 KB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** exponent;
  const formatted =
    value >= 100 || exponent === 0
      ? Math.round(value).toString()
      : value.toFixed(1);

  return `${formatted} ${units[exponent]}`;
}

function emptyBreakdown(profileId: string, error?: string): StorageBreakdown {
  return {
    profileId,
    databaseBytes: 0,
    walBytes: 0,
    workspaceStorageBytes: 0,
    editorCacheBytes: 0,
    extensionCacheBytes: 0,
    totalBytes: 0,
    error,
  };
}

/**
 * Calculates per-profile storage breakdown using an injected filesystem port.
 */
export class ProfileStorageAnalyzer implements IProfileStorageAnalyzer {
  constructor(private readonly fileSystem: IFileSystemService) {}

  async calculateProfileStorageSize(
    profileId: string,
    userDataDir: string
  ): Promise<StorageBreakdown> {
    const validation = validateUserDataPath(userDataDir);
    if (!validation.valid) {
      return emptyBreakdown(profileId, validation.error);
    }

    try {
      const stateDbPath = getProfileStateDbPath(userDataDir);
      const globalStorageDir = path.join(userDataDir, 'User', 'globalStorage');
      const workspaceStorageDir = path.join(
        userDataDir,
        'User',
        'workspaceStorage'
      );

      const databaseBytes = await this.fileSystem.getFileSize(stateDbPath);
      const walBytes =
        (await this.fileSystem.getFileSize(`${stateDbPath}-wal`)) +
        (await this.fileSystem.getFileSize(`${stateDbPath}-shm`));

      const workspaceStorageBytes =
        await this.fileSystem.getPathSize(workspaceStorageDir);

      let editorCacheBytes = 0;
      for (const dirName of EDITOR_CACHE_DIRS) {
        editorCacheBytes += await this.fileSystem.getPathSize(
          path.join(userDataDir, dirName)
        );
      }

      const globalStorageBytes =
        await this.fileSystem.getPathSize(globalStorageDir);
      const extensionCacheBytes = Math.max(
        0,
        globalStorageBytes - databaseBytes - walBytes
      );

      const totalBytes =
        databaseBytes +
        walBytes +
        workspaceStorageBytes +
        editorCacheBytes +
        extensionCacheBytes;

      return {
        profileId,
        databaseBytes,
        walBytes,
        workspaceStorageBytes,
        editorCacheBytes,
        extensionCacheBytes,
        totalBytes,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return emptyBreakdown(profileId, message);
    }
  }

  async getProfileTotalBytes(userDataDir: string): Promise<number> {
    const breakdown = await this.calculateProfileStorageSize('', userDataDir);
    return breakdown.totalBytes;
  }
}
