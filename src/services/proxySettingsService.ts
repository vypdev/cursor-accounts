import type { RestoreAllProfilesResult } from '../domain/ports/IProxyLifecycle';
import type { IProxySettingsBackupReader } from '../domain/ports/IProxySettingsBackupReader';
import type { IProxySettingsRestorer } from '../domain/ports/IProxySettingsRestorer';
import type { ProxyBackupInfo } from '../domain/ports/IProfileSettingsManager';
import type { ProxySettingsApplicationService } from '../application/services/proxySettingsApplicationService';
import type { ProxySettingsBackupReader } from '../application/services/proxySettingsBackupReader';
import type { ProxySettingsRestorationService } from '../application/services/proxySettingsRestorationService';

export type { RestoreAllProfilesResult };

/**
 * Compatibility facade for the proxy-settings application use cases.
 */
export class ProxySettingsService
  implements IProxySettingsBackupReader, IProxySettingsRestorer
{
  constructor(
    private readonly applicationService: Pick<
      ProxySettingsApplicationService,
      'applyProxyForAllProfiles' | 'applyProxyForRunningProfiles'
    >,
    private readonly restorationService: Pick<
      ProxySettingsRestorationService,
      'restoreAllProfiles'
    >,
    private readonly backupReader: Pick<
      ProxySettingsBackupReader,
      'getAllProxyBackupInfo'
    >
  ) {}

  /**
   * Write proxy to disk for every managed profile and sync the active window UI.
   */
  async applyProxyForAllProfiles(proxyUrl: string): Promise<void> {
    await this.applicationService.applyProxyForAllProfiles(proxyUrl);
  }

  /**
   * Apply proxy only to profiles that currently have a running Cursor instance.
   */
  async applyProxyForRunningProfiles(proxyUrl: string): Promise<void> {
    await this.applicationService.applyProxyForRunningProfiles(proxyUrl);
  }

  async restoreAllProfiles(): Promise<RestoreAllProfilesResult> {
    return await this.restorationService.restoreAllProfiles();
  }

  async getAllProxyBackupInfo(): Promise<Map<string, ProxyBackupInfo>> {
    return await this.backupReader.getAllProxyBackupInfo();
  }
}
