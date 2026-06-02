import * as path from 'path';
import type { StorageBreakdown } from '@cursor-accounts/types';
import { createEmptyStorageBreakdown } from '@cursor-accounts/types';
import type { IFileSystemService } from '../domain/ports/IFileSystemService';
import type { IProfileStorageAnalyzer } from '../domain/ports/IProfileStorageAnalyzer';
import { getProfileStateDbPath } from '../auth/cursorPaths';
import { validateUserDataPath } from '../utils/pathUtils';
import { EFFICIENCY_DB_FILENAME } from '../persistence/types';
import { EDITOR_CACHE_DIRS, isDeepCleanBackupFile } from './storageConstants';

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
      return createEmptyStorageBreakdown(profileId, validation.error);
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

      const efficiencyDbPath = path.join(globalStorageDir, EFFICIENCY_DB_FILENAME);
      const efficiencyDbBytes =
        (await this.fileSystem.getFileSize(efficiencyDbPath)) +
        (await this.fileSystem.getFileSize(`${efficiencyDbPath}-wal`)) +
        (await this.fileSystem.getFileSize(`${efficiencyDbPath}-shm`));

      const globalStorageBytes = await this.fileSystem.getPathSize(
        globalStorageDir,
        { exclude: isDeepCleanBackupFile }
      );
      const extensionCacheBytes = Math.max(
        0,
        globalStorageBytes -
          databaseBytes -
          walBytes -
          efficiencyDbBytes
      );

      const totalBytes =
        databaseBytes +
        walBytes +
        workspaceStorageBytes +
        editorCacheBytes +
        extensionCacheBytes +
        efficiencyDbBytes;

      return {
        profileId,
        databaseBytes,
        walBytes,
        workspaceStorageBytes,
        editorCacheBytes,
        extensionCacheBytes,
        efficiencyDbBytes,
        totalBytes,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return createEmptyStorageBreakdown(profileId, message);
    }
  }

  async getProfileTotalBytes(userDataDir: string): Promise<number> {
    const breakdown = await this.calculateProfileStorageSize('', userDataDir);
    return breakdown.totalBytes;
  }
}
