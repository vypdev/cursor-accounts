import { createEmptyStorageBreakdown, type StorageCleanupOptions } from '@cursor-accounts/types';
import type { IProfileStorageAnalyzer } from '../domain/ports/IProfileStorageAnalyzer';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IStorageCleanupService } from '../domain/ports/IStorageCleanupService';
import type { ToWebviewMessage } from '../profiles/types';
import { t } from '../l10n';
import * as extensionLog from '../logging/extensionLog';

export interface AccountsPanelStorageHandlerDependencies {
  profileManager: IProfileManager;
  storageAnalyzer: IProfileStorageAnalyzer;
  storageCleanupService: IStorageCleanupService;
}

export interface AccountsPanelStorageHandlerCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
}

/** Handles storage inspection and cleanup actions for one profile. */
export class AccountsPanelStorageHandlers {
  constructor(
    private readonly dependencies: AccountsPanelStorageHandlerDependencies,
    private readonly callbacks: AccountsPanelStorageHandlerCallbacks
  ) {}

  async requestInfo(profileId: string): Promise<void> {
    const profile = await this.dependencies.profileManager.getProfile(profileId);
    if (!profile) {
      await this.callbacks.postMessage({
        type: 'storageInfo',
        data: createEmptyStorageBreakdown(
          profileId,
          t('errors.profileNotFound')
        ),
      });
      return;
    }

    const breakdown = await this.getBreakdown(profileId, profile.userDataDir);
    await this.callbacks.postMessage({
      type: 'storageInfo',
      data: breakdown,
    });
  }

  async clean(profileId: string, options: StorageCleanupOptions): Promise<void> {
    extensionLog.info(
      `[AccountsPanel] Storage cleanup requested for ${profileId}: ${options.action}`
    );
    const result = await this.dependencies.storageCleanupService.cleanProfileStorage(
      profileId,
      options
    );

    await this.callbacks.postMessage({
      type: 'storageCleanupResult',
      data: result,
    });

    if (!result.success) {
      return;
    }

    const profile = await this.dependencies.profileManager.getProfile(profileId);
    if (!profile) {
      return;
    }

    await this.callbacks.postMessage({
      type: 'storageInfo',
      data: await this.getBreakdown(profileId, profile.userDataDir),
    });
  }

  private async getBreakdown(profileId: string, userDataDir: string) {
    return this.dependencies.storageAnalyzer.calculateProfileStorageSize(
      profileId,
      userDataDir
    );
  }
}
