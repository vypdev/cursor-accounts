import * as path from 'path';
import * as vscode from 'vscode';
import type { ICacheCleanupService } from '../domain/ports/ICacheCleanupService';
import { PartialCleanupError } from '../domain/types/storageCleanup';
import type { IFileSystemService } from '../domain/ports/IFileSystemService';
import * as extensionLog from '../logging/extensionLog';
import type { EfficiencyService } from '../modelEfficiency/efficiencyService';
import {
  DELETE_OLD_CHATS_COMMANDS,
  EDITOR_CACHE_DIRS,
  GC_AGENT_KV_COMMANDS,
  LEADERBOARD_CACHE_KEY,
  QUOTA_CACHE_KEY,
} from './storageConstants';

export interface VSCodeCacheServiceDeps {
  context: vscode.ExtensionContext;
  fileSystem: IFileSystemService;
  efficiencyService: EfficiencyService;
  isCurrentProfile: (profileId: string) => Promise<boolean>;
}

/**
 * Cache cleanup via filesystem and VS Code/Cursor built-in commands.
 */
export class VSCodeCacheService implements ICacheCleanupService {
  constructor(private readonly deps: VSCodeCacheServiceDeps) {}

  /**
   * Remove Electron editor cache directories under the profile user-data dir.
   * @remarks Profile must be closed; otherwise files may be locked (EBUSY).
   */
  async cleanEditorCache(userDataDir: string): Promise<number> {
    let removedBytes = 0;
    try {
      for (const dirName of EDITOR_CACHE_DIRS) {
        const result = await this.deps.fileSystem.removeDirectory(
          path.join(userDataDir, dirName)
        );
        removedBytes += result.bytes;
      }
    } catch (error) {
      if (removedBytes === 0) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new PartialCleanupError(
        `Editor cache cleanup partially completed after reclaiming ${removedBytes} bytes: ${message}`,
        removedBytes,
        { cause: error }
      );
    }
    return removedBytes;
  }

  /**
   * Clear extension-owned quota and leaderboard cache entries for a profile.
   * @remarks Restarts the prompt detector when clearing the active profile cache.
   */
  async cleanExtensionCache(profileId: string): Promise<void> {
    const quotaCache =
      this.deps.context.globalState.get<Array<{ id: string; quota: unknown }>>(
        QUOTA_CACHE_KEY
      ) ?? [];
    const filteredQuota = quotaCache.filter((entry) => entry.id !== profileId);
    await this.deps.context.globalState.update(QUOTA_CACHE_KEY, filteredQuota);

    const leaderboardCache =
      this.deps.context.globalState.get<Record<string, unknown>>(
        LEADERBOARD_CACHE_KEY
      ) ?? {};
    if (profileId in leaderboardCache) {
      delete leaderboardCache[profileId];
      await this.deps.context.globalState.update(
        LEADERBOARD_CACHE_KEY,
        leaderboardCache
      );
    }

    if (await this.deps.isCurrentProfile(profileId)) {
      await this.deps.efficiencyService.restartPromptDetector();
    }

    extensionLog.info(
      `[StorageCleanup] Extension cache cleared for profile ${profileId}`
    );
  }

  /**
   * Attempt Cursor's built-in delete-old-chats command on the active window.
   */
  async deleteOldChats(chatAgeDays: number): Promise<boolean> {
    return this.tryExecuteCommands(DELETE_OLD_CHATS_COMMANDS, [chatAgeDays]);
  }

  /**
   * Attempt Cursor's built-in GC agent KV blobs command on the active window.
   */
  async gcAgentKvBlobs(): Promise<boolean> {
    return this.tryExecuteCommands(GC_AGENT_KV_COMMANDS);
  }

  private async tryExecuteCommands(
    commandIds: readonly string[],
    args: unknown[] = []
  ): Promise<boolean> {
    for (const commandId of commandIds) {
      try {
        await vscode.commands.executeCommand(commandId, ...args);
        extensionLog.info(`[StorageCleanup] Executed command ${commandId}`);
        return true;
      } catch {
        // Try next candidate command id.
      }
    }
    return false;
  }
}
