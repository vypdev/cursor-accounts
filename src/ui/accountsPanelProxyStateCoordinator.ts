import { isProfileProxyEnabled, type Profile, type ProxyStatus, type ToWebviewMessage } from '@cursor-accounts/types';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProxyPanelRead } from '../domain/ports/IProxyPanelRead';
import type { IProxySettingsBackupReader } from '../domain/ports/IProxySettingsBackupReader';

interface AccountsPanelProxyState {
  proxyStatus: ProxyStatus | null;
  currentWindowUsesProxy: boolean;
  profileProxyTemporary: Record<string, boolean>;
}

export interface AccountsPanelProxyStateCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
  hasActiveWebview(): boolean;
}

export interface ProxyStatusReadOptions {
  checkCertificate?: boolean;
}

export interface AccountsPanelProxyStateDependencies {
  profileDetector: IProfileDetector;
  proxyManager: IProxyPanelRead;
  proxySettingsReader?: IProxySettingsBackupReader;
}

function isProxyUiEnabled(currentProfile: Profile | null): boolean {
  return currentProfile != null && isProfileProxyEnabled(currentProfile);
}

/** Reads and publishes the proxy state needed by the Accounts panel. */
export class AccountsPanelProxyStateCoordinator {
  constructor(
    private readonly dependencies: AccountsPanelProxyStateDependencies,
    private readonly callbacks: AccountsPanelProxyStateCallbacks
  ) {}

  async read(
    currentProfile: Profile | null,
    options?: ProxyStatusReadOptions
  ): Promise<AccountsPanelProxyState> {
    const proxyEnabled = isProxyUiEnabled(currentProfile);

    return {
      proxyStatus: proxyEnabled
        ? await this.readProxyStatus(currentProfile, options)
        : null,
      currentWindowUsesProxy: proxyEnabled
        ? await this.dependencies.proxyManager.isCurrentWindowUsingProxy()
        : false,
      profileProxyTemporary: await this.readTemporaryProfiles(currentProfile),
    };
  }

  async refresh(options?: ProxyStatusReadOptions): Promise<void> {
    if (!this.callbacks.hasActiveWebview()) {
      return;
    }

    const currentProfile =
      await this.dependencies.profileDetector.detectCurrentProfile();
    const state = await this.read(currentProfile, options);

    await this.callbacks.postMessage({
      type: 'proxyStatus',
      data: state.proxyStatus,
    });
    await this.callbacks.postMessage({
      type: 'currentWindowProxyUsage',
      usesProxy: state.currentWindowUsesProxy,
    });
  }

  private async readTemporaryProfiles(
    currentProfile: Profile | null
  ): Promise<Record<string, boolean>> {
    if (!isProxyUiEnabled(currentProfile) || !this.dependencies.proxySettingsReader) {
      return {};
    }

    const backupInfo =
      await this.dependencies.proxySettingsReader.getAllProxyBackupInfo();
    const result: Record<string, boolean> = {};

    for (const [profileId, info] of backupInfo) {
      if (info.hasBackup) {
        result[profileId] = true;
        continue;
      }

      const proxyUrl =
        await this.dependencies.proxyManager.getProxyServerUrl(profileId);
      if (proxyUrl != null && info.currentProxyUrl === proxyUrl) {
        result[profileId] = true;
      }
    }

    return result;
  }

  private async readProxyStatus(
    currentProfile: Profile | null,
    options?: ProxyStatusReadOptions
  ): Promise<ProxyStatus | null> {
    if (!currentProfile) {
      return null;
    }

    const status = await this.dependencies.proxyManager.getStatus(
      currentProfile.id
    );
    if (!status) {
      return null;
    }

    const caCertificateInstalled = options?.checkCertificate
      ? await this.dependencies.proxyManager.checkCertificateInstalled()
      : this.dependencies.proxyManager.getCachedCertificateInstalled();

    if (caCertificateInstalled === undefined) {
      return status;
    }

    return { ...status, caCertificateInstalled };
  }
}
