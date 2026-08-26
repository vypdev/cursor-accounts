import type {
  StorageCleanupOptions,
  StorageCleanupResult,
} from '@cursor-accounts/types';
import type { IProfileStorageAnalyzer } from '../domain/ports/IProfileStorageAnalyzer';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { IStorageCleanupService } from '../domain/ports/IStorageCleanupService';
import * as extensionLog from '../logging/extensionLog';
import { t } from '../l10n';
import { validateUserDataPath } from '../utils/pathUtils';
import { formatBytes } from '@cursor-accounts/shared';
import { PartialCleanupError } from '../domain/types/storageCleanup';
import {
  StorageCleanupActionRunner,
  type StorageCleanupActionRunnerDeps,
} from './storageCleanupActionRunner';

const ACTIONS_WITHOUT_FS_DELTA = new Set<StorageCleanupOptions['action']>([
  'deleteOldChats',
  'gcAgentKvBlobs',
  'cleanExtensionCache',
  'deepCleanDatabase',
]);

export interface StorageCleanupServiceDeps
  extends StorageCleanupActionRunnerDeps {
  profileManager: IProfileReader;
  storageAnalyzer: IProfileStorageAnalyzer;
}

/**
 * Orchestrates profile storage cleanup actions and filesystem accounting.
 * Policy-specific actions are delegated to the action runner and injected ports.
 */
export class StorageCleanupService implements IStorageCleanupService {
  private readonly actionRunner: StorageCleanupActionRunner;

  constructor(private readonly deps: StorageCleanupServiceDeps) {
    this.actionRunner = new StorageCleanupActionRunner(deps);
  }

  /**
   * Run a cleanup action for the given profile.
   *
   * @example
   * await service.cleanProfileStorage('p1', { action: 'cleanExtensionCache' });
   *
   * @remarks Filesystem deltas are measured only for actions that can
   * deterministically change the profile's on-disk footprint.
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
      const result = await this.actionRunner.run(
        profileId,
        profile.userDataDir,
        options
      );
      return skipsFilesystemDelta
        ? result
        : await this.withFilesystemDelta(
            result,
            beforeBytes,
            profile.userDataDir
          );
    } catch (error) {
      return this.toFailureResult(error, options.action, profileId);
    }
  }

  private async withFilesystemDelta(
    result: StorageCleanupResult,
    beforeBytes: number,
    userDataDir: string
  ): Promise<StorageCleanupResult> {
    if (!result.success) {
      return result;
    }

    const afterBytes = await this.deps.storageAnalyzer.getProfileTotalBytes(
      userDataDir
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

  private toFailureResult(
    error: unknown,
    action: StorageCleanupOptions['action'],
    profileId: string
  ): StorageCleanupResult {
    const message = error instanceof Error ? error.message : t('errors.unknown');
    const bytesReclaimed =
      error instanceof PartialCleanupError ? error.bytesReclaimed : 0;
    extensionLog.error(
      `[StorageCleanup] ${action} failed for ${profileId}: ${message}`
    );
    return {
      success: false,
      bytesReclaimed,
      message,
      error: message,
    };
  }
}
