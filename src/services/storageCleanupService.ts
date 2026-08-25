import type {
  StorageCleanupOptions,
  StorageCleanupResult,
} from '@cursor-accounts/types';
import type { ICacheCleanupService } from '../domain/ports/ICacheCleanupService';
import type { IDatabaseCleanupService } from '../domain/ports/IDatabaseCleanupService';
import type { IProfileStorageAnalyzer } from '../domain/ports/IProfileStorageAnalyzer';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IStorageCleanupService } from '../domain/ports/IStorageCleanupService';
import { getProfileStateDbPath } from '../auth/cursorPaths';
import * as extensionLog from '../logging/extensionLog';
import { t } from '../l10n';
import type { InstanceDetector } from '../profiles/instanceDetector';
import type { ProfileDetector } from '../profiles/profileDetector';
import { validateUserDataPath } from '../utils/pathUtils';
import { formatBytes } from '@cursor-accounts/shared';
import { EfficiencyDatabase, getEfficiencyDbPath } from '../persistence/efficiencyDatabase';

const ACTIONS_WITHOUT_FS_DELTA = new Set<StorageCleanupOptions['action']>([
  'deleteOldChats',
  'gcAgentKvBlobs',
  'cleanExtensionCache',
  'deepCleanDatabase',
]);

const EFFICIENCY_EVENTS_RETENTION_DAYS = 90;

export interface StorageCleanupServiceDeps {
  profileManager: IProfileManager;
  profileDetector: ProfileDetector;
  instanceDetector: InstanceDetector;
  storageAnalyzer: IProfileStorageAnalyzer;
  cacheCleanup: ICacheCleanupService;
  databaseCleanup: IDatabaseCleanupService;
  extensionPath: string;
}

/**
 * Orchestrates profile storage cleanup actions.
 * Delegates filesystem, SQLite, and VS Code command work to injected ports.
 */
export class StorageCleanupService implements IStorageCleanupService {
  constructor(private readonly deps: StorageCleanupServiceDeps) {}

  /**
   * Run a cleanup action for the given profile.
   *
   * @example
   * await service.cleanProfileStorage('p1', { action: 'cleanExtensionCache' });
   *
   * @remarks
   * - `deleteOldChats` / `gcAgentKvBlobs` require the profile in the current window.
   * - `cleanEditorCache`, `vacuumDatabase`, `deepCleanDatabase` require the profile closed.
   */
  async cleanProfileStorage(
    profileId: string,
    options: StorageCleanupOptions
  ): Promise<StorageCleanupResult> {
    const profile = await this.deps.profileManager.getProfile(profileId);
    if (!profile) {
      return {
        success: false,
        bytesReclaimed: 0,
        message: t('storageCleanup.profileNotFound'),
        error: t('errors.profileNotFound'),
      };
    }

    const validation = validateUserDataPath(profile.userDataDir);
    if (!validation.valid) {
      return {
        success: false,
        bytesReclaimed: 0,
        message: validation.error ?? t('storageCleanup.invalidPath'),
        error: validation.error,
      };
    }

    const skipsFilesystemDelta = ACTIONS_WITHOUT_FS_DELTA.has(options.action);
    const beforeBytes = skipsFilesystemDelta
      ? 0
      : await this.deps.storageAnalyzer.getProfileTotalBytes(profile.userDataDir);

    try {
      let result: StorageCleanupResult;

      switch (options.action) {
        case 'cleanExtensionCache':
          result = await this.runCleanExtensionCache(profileId);
          break;
        case 'deleteOldChats':
          result = await this.runDeleteOldChats(
            profileId,
            options.chatAgeDays ?? 30
          );
          break;
        case 'gcAgentKvBlobs':
          result = await this.runGcAgentKvBlobs(profileId);
          break;
        case 'cleanEditorCache':
          result = await this.runCleanEditorCache(
            profileId,
            profile.userDataDir
          );
          break;
        case 'vacuumDatabase':
          result = await this.runVacuumDatabase(
            profileId,
            profile.userDataDir
          );
          break;
        case 'deepCleanDatabase':
          result = await this.runDeepCleanDatabase(
            profileId,
            profile.userDataDir
          );
          break;
        case 'cleanEfficiencyEvents':
          result = await this.runCleanEfficiencyEvents(
            profileId,
            profile.userDataDir
          );
          break;
        default:
          result = {
            success: false,
            bytesReclaimed: 0,
            message: t('storageCleanup.unknownAction'),
            error: t('storageCleanup.unknownAction'),
          };
      }

      if (result.success && !skipsFilesystemDelta) {
        const afterBytes = await this.deps.storageAnalyzer.getProfileTotalBytes(
          profile.userDataDir
        );
        const reclaimed = Math.max(0, beforeBytes - afterBytes);
        return {
          ...result,
          bytesReclaimed: reclaimed > 0 ? reclaimed : result.bytesReclaimed,
          message:
            reclaimed > 0
              ? t('storageCleanup.freedSpace', {
                  amount: formatBytes(reclaimed),
                })
              : result.message,
        };
      }

      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('errors.unknown');
      extensionLog.error(
        `[StorageCleanup] ${options.action} failed for ${profileId}: ${message}`
      );
      return {
        success: false,
        bytesReclaimed: 0,
        message,
        error: message,
      };
    }
  }

  /**
   * @throws Error when the profile has running Cursor instances.
   */
  private async ensureProfileClosed(profileId: string): Promise<void> {
    const running = await this.deps.instanceDetector.isProfileRunning(profileId);
    if (running) {
      throw new Error(t('storageCleanup.profileRunning'));
    }
  }

  private async isCurrentProfile(profileId: string): Promise<boolean> {
    const current = await this.deps.profileDetector.detectCurrentProfile();
    return current?.id === profileId;
  }

  private async runCleanExtensionCache(
    profileId: string
  ): Promise<StorageCleanupResult> {
    await this.deps.cacheCleanup.cleanExtensionCache(profileId);
    return {
      success: true,
      bytesReclaimed: 0,
      message: t('storageCleanup.extensionCacheCleared'),
    };
  }

  private async runDeleteOldChats(
    profileId: string,
    chatAgeDays: number
  ): Promise<StorageCleanupResult> {
    if (!(await this.isCurrentProfile(profileId))) {
      return {
        success: false,
        bytesReclaimed: 0,
        message: t('storageCleanup.deleteOldChatsCurrentWindowOnly'),
        error: t('storageCleanup.deleteOldChatsCurrentWindowOnly'),
      };
    }

    const executed = await this.deps.cacheCleanup.deleteOldChats(chatAgeDays);

    if (executed) {
      return {
        success: true,
        bytesReclaimed: 0,
        message: t('storageCleanup.deleteOldChatsStarted', { days: chatAgeDays }),
      };
    }

    return {
      success: false,
      bytesReclaimed: 0,
      message: t('storageCleanup.deleteOldChatsManual', { days: chatAgeDays }),
      error: t('storageCleanup.commandUnavailable'),
    };
  }

  private async runGcAgentKvBlobs(
    profileId: string
  ): Promise<StorageCleanupResult> {
    if (!(await this.isCurrentProfile(profileId))) {
      return {
        success: false,
        bytesReclaimed: 0,
        message: t('storageCleanup.gcCurrentWindowOnly'),
        error: t('storageCleanup.gcCurrentWindowOnly'),
      };
    }

    const executed = await this.deps.cacheCleanup.gcAgentKvBlobs();

    if (executed) {
      return {
        success: true,
        bytesReclaimed: 0,
        message: t('storageCleanup.gcStarted'),
      };
    }

    return {
      success: false,
      bytesReclaimed: 0,
      message: t('storageCleanup.gcManual'),
      error: t('storageCleanup.commandUnavailable'),
    };
  }

  private async runCleanEditorCache(
    profileId: string,
    userDataDir: string
  ): Promise<StorageCleanupResult> {
    await this.ensureProfileClosed(profileId);
    const removedBytes =
      await this.deps.cacheCleanup.cleanEditorCache(userDataDir);

    return {
      success: true,
      bytesReclaimed: removedBytes,
      message: t('storageCleanup.editorCacheCleared', {
        amount: formatBytes(removedBytes),
      }),
    };
  }

  private async runVacuumDatabase(
    profileId: string,
    userDataDir: string
  ): Promise<StorageCleanupResult> {
    await this.ensureProfileClosed(profileId);

    const stateDbPath = getProfileStateDbPath(userDataDir);
    await this.deps.databaseCleanup.vacuum(stateDbPath);

    return {
      success: true,
      bytesReclaimed: 0,
      message: t('storageCleanup.vacuumCompleted'),
    };
  }

  /**
   * @remarks Creates a timestamped backup before deleting composer/agent KV rows.
   */
  private async runDeepCleanDatabase(
    profileId: string,
    userDataDir: string
  ): Promise<StorageCleanupResult> {
    await this.ensureProfileClosed(profileId);

    const stateDbPath = getProfileStateDbPath(userDataDir);
    const { bytesReclaimed } =
      await this.deps.databaseCleanup.deepClean(stateDbPath);

    return {
      success: true,
      bytesReclaimed,
      message: t('storageCleanup.deepCleanCompleted', {
        amount: formatBytes(bytesReclaimed),
      }),
    };
  }

  private async runCleanEfficiencyEvents(
    profileId: string,
    userDataDir: string
  ): Promise<StorageCleanupResult> {
    await this.ensureProfileClosed(profileId);

    const dbPath = getEfficiencyDbPath(userDataDir);
    const beforeBytes = await this.deps.storageAnalyzer
      .calculateProfileStorageSize(profileId, userDataDir)
      .then((b) => b.efficiencyDbBytes);

    const cutoffSeconds =
      Math.floor(Date.now() / 1000) -
      EFFICIENCY_EVENTS_RETENTION_DAYS * 24 * 60 * 60;

    const db = new EfficiencyDatabase(dbPath, this.deps.extensionPath);
    await db.initialize();
    const removed = await db.deleteOldEvents(profileId, cutoffSeconds);
    await db.vacuum();

    const afterBytes = await this.deps.storageAnalyzer
      .calculateProfileStorageSize(profileId, userDataDir)
      .then((b) => b.efficiencyDbBytes);
    const bytesReclaimed = Math.max(0, beforeBytes - afterBytes);

    return {
      success: true,
      bytesReclaimed,
      message: t('storageCleanup.efficiencyEventsCleaned', {
        count: removed,
        days: EFFICIENCY_EVENTS_RETENTION_DAYS,
        amount: formatBytes(bytesReclaimed),
      }),
    };
  }
}
