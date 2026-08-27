import type { IProfileReader } from '../../domain/ports/IProfileReader';
import type { IProfileSettingsManager } from '../../domain/ports/IProfileSettingsManager';
import type {
  IProxySettingsRestorer,
  RestoreAllProfilesResult,
} from '../../domain/ports/IProxySettingsRestorer';
import type { IProxyWindowConfiguration } from '../../domain/ports/IProxyWindowConfiguration';

export interface ProxySettingsRestorationServiceDependencies {
  profileReader: IProfileReader;
  profileSettingsManager: IProfileSettingsManager;
  windowConfiguration: IProxyWindowConfiguration;
  error(message: string): void;
  debug(message: string): void;
}

/** Restores profile-owned proxy settings and clears the active window override. */
export class ProxySettingsRestorationService
  implements IProxySettingsRestorer
{
  constructor(
    private readonly dependencies: ProxySettingsRestorationServiceDependencies
  ) {}

  async restoreAllProfiles(): Promise<RestoreAllProfilesResult> {
    const profiles = await this.dependencies.profileReader.getProfiles();
    const result: RestoreAllProfilesResult = {
      restored: 0,
      errors: [],
    };

    for (const profile of profiles) {
      try {
        await this.dependencies.profileSettingsManager.restoreProxySettings(
          profile.userDataDir
        );
        result.restored += 1;
      } catch (error) {
        const message = formatError(error);
        this.dependencies.error(
          `[ProxySettings] Failed to restore ${profile.displayName}: ${message}`
        );
        result.errors.push({ profileId: profile.id, error: message });
      }
    }

    try {
      await this.dependencies.windowConfiguration.clearProxy();
    } catch (error) {
      this.dependencies.debug(
        `[ProxySettings] Failed to clear active window proxy config: ${formatError(error)}`
      );
    }

    return result;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
