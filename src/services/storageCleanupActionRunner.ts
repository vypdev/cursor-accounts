import type {
  StorageCleanupOptions,
  StorageCleanupResult,
} from '@cursor-accounts/types';
import { formatBytes } from '@cursor-accounts/shared';
import type { ICacheCleanupService } from '../domain/ports/ICacheCleanupService';
import type { IDatabaseCleanupService } from '../domain/ports/IDatabaseCleanupService';
import type { IEfficiencyEventsCleanupService } from '../domain/ports/IEfficiencyEventsCleanupService';
import type { IInstanceDetector } from '../domain/ports/IInstanceDetector';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import { getProfileStateDbPath } from '../auth/cursorPaths';
import { t } from '../l10n';

const EFFICIENCY_EVENTS_RETENTION_DAYS = 90;

export interface StorageCleanupActionRunnerDeps {
  profileDetector: IProfileDetector;
  instanceDetector: IInstanceDetector;
  cacheCleanup: ICacheCleanupService;
  databaseCleanup: IDatabaseCleanupService;
  efficiencyEventsCleanup: IEfficiencyEventsCleanupService;
}

/**
 * Executes the policy-specific profile cleanup actions.
 * Filesystem accounting and error translation stay in the orchestration service.
 */
export class StorageCleanupActionRunner {
  constructor(private readonly deps: StorageCleanupActionRunnerDeps) {}

  async run(
    profileId: string,
    userDataDir: string,
    options: StorageCleanupOptions
  ): Promise<StorageCleanupResult> {
    switch (options.action) {
      case 'cleanExtensionCache':
        return this.runCleanExtensionCache(profileId);
      case 'deleteOldChats':
        return this.runDeleteOldChats(profileId, options.chatAgeDays ?? 30);
      case 'gcAgentKvBlobs':
        return this.runGcAgentKvBlobs(profileId);
      case 'cleanEditorCache':
        return this.runCleanEditorCache(profileId, userDataDir);
      case 'vacuumDatabase':
        return this.runVacuumDatabase(profileId, userDataDir);
      case 'deepCleanDatabase':
        return this.runDeepCleanDatabase(profileId, userDataDir);
      case 'cleanEfficiencyEvents':
        return this.runCleanEfficiencyEvents(profileId, userDataDir);
      default:
        return {
          success: false,
          bytesReclaimed: 0,
          message: t('storageCleanup.unknownAction'),
          error: t('storageCleanup.unknownAction'),
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

    const cutoffSeconds =
      Math.floor(Date.now() / 1000) -
      EFFICIENCY_EVENTS_RETENTION_DAYS * 24 * 60 * 60;
    const { removedEvents, bytesReclaimed } =
      await this.deps.efficiencyEventsCleanup.cleanOldEvents(
        profileId,
        userDataDir,
        cutoffSeconds
      );

    return {
      success: true,
      bytesReclaimed,
      message: t('storageCleanup.efficiencyEventsCleaned', {
        count: removedEvents,
        days: EFFICIENCY_EVENTS_RETENTION_DAYS,
        amount: formatBytes(bytesReclaimed),
      }),
    };
  }
}
