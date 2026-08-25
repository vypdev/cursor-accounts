import { isProfileProxyEnabled } from '@cursor-accounts/types';
import * as extensionLog from '../logging/extensionLog';
import type { IProfileProxyLaunchCoordinator, ProfileProxyLaunchContext } from '../domain/ports/IProfileProxyLaunchCoordinator';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import type { IProxyCertificate } from '../domain/ports/IProxyCertificate';
import type { IProxyLifecycle } from '../domain/ports/IProxyLifecycle';
import type { IProxyRouting } from '../domain/ports/IProxyRouting';
import type { Profile } from './types';

export type ProfileProxyManager = IProxyLifecycle & IProxyRouting & IProxyCertificate;

/** Prepares the optional MITM proxy context needed by a Cursor launch. */
export class ProfileProxyLaunchCoordinator
  implements IProfileProxyLaunchCoordinator
{
  constructor(
    private readonly proxyManager?: ProfileProxyManager,
    private readonly profileSettingsManager?: IProfileSettingsManager
  ) {}

  async resolve(
    profile: Profile,
    userDataDir: string
  ): Promise<ProfileProxyLaunchContext | null> {
    if (!this.proxyManager || !isProfileProxyEnabled(profile)) {
      return null;
    }

    const running = await this.proxyManager.isRunning(profile.id);
    if (!running) {
      const startResult = await this.proxyManager.ensureProfileProxy(profile.id);
      if (!startResult.success) {
        extensionLog.warn(
          `[ProfileLauncher] Failed to start proxy for ${profile.id}: ${startResult.error ?? 'unknown error'}`
        );
        return null;
      }
    }

    const proxyUrl = await this.proxyManager.getProxyServerUrl(profile.id);
    if (!proxyUrl) {
      return null;
    }

    await this.applyProfileSettings(profile.id, userDataDir, proxyUrl);

    return {
      proxyUrl,
      caCertPath: (await this.proxyManager.getCertificatePath()) ?? '',
    };
  }

  private async applyProfileSettings(
    profileId: string,
    userDataDir: string,
    proxyUrl: string
  ): Promise<void> {
    if (!this.profileSettingsManager) {
      return;
    }

    try {
      await this.profileSettingsManager.applyProxySettings(
        userDataDir,
        proxyUrl
      );
    } catch (error) {
      extensionLog.warn(
        `[ProfileLauncher] Failed to apply proxy settings for ${profileId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
