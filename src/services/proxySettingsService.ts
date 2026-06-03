import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { RestoreAllProfilesResult } from '../domain/ports/IProxyManager';
import type {
  IProfileSettingsManager,
  ProxyBackupInfo,
} from '../domain/ports/IProfileSettingsManager';
import * as extensionLog from '../logging/extensionLog';

export type { RestoreAllProfilesResult };

/**
 * Application service: orchestrate proxy settings across all managed profiles.
 */
export class ProxySettingsService {
  constructor(
    private readonly profileManager: IProfileManager,
    private readonly profileSettingsManager: IProfileSettingsManager
  ) {}

  async restoreAllProfiles(): Promise<RestoreAllProfilesResult> {
    const profiles = await this.profileManager.getProfiles();
    const result: RestoreAllProfilesResult = {
      restored: 0,
      errors: [],
    };

    for (const profile of profiles) {
      try {
        await this.profileSettingsManager.restoreProxySettings(
          profile.userDataDir
        );
        result.restored += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        extensionLog.error(
          `[ProxySettings] Failed to restore ${profile.displayName}: ${message}`
        );
        result.errors.push({ profileId: profile.id, error: message });
      }
    }

    return result;
  }

  async getAllProxyBackupInfo(): Promise<Map<string, ProxyBackupInfo>> {
    const profiles = await this.profileManager.getProfiles();
    const infoMap = new Map<string, ProxyBackupInfo>();

    await Promise.all(
      profiles.map(async (profile) => {
        try {
          const info = await this.profileSettingsManager.getProxyBackupInfo(
            profile.userDataDir
          );
          infoMap.set(profile.id, info);
        } catch (error) {
          extensionLog.debug(
            `[ProxySettings] Failed to get backup info for ${profile.id}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      })
    );

    return infoMap;
  }
}
