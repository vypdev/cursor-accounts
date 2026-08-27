import type { Profile } from '@cursor-accounts/types';
import type { IInstanceDetector } from '../../domain/ports/IInstanceDetector';
import type { IProfileReader } from '../../domain/ports/IProfileReader';
import type { IProfileSettingsManager } from '../../domain/ports/IProfileSettingsManager';
import type { IProxyWindowConfiguration } from '../../domain/ports/IProxyWindowConfiguration';

export interface ProxySettingsApplicationServiceDependencies {
  profileReader: IProfileReader;
  profileSettingsManager: IProfileSettingsManager;
  windowConfiguration: IProxyWindowConfiguration;
  instanceDetector?: IInstanceDetector;
  warn(message: string): void;
}

/** Applies temporary proxy settings to selected profiles and the active window. */
export class ProxySettingsApplicationService {
  constructor(
    private readonly dependencies: ProxySettingsApplicationServiceDependencies
  ) {}

  async applyProxyForAllProfiles(proxyUrl: string): Promise<void> {
    const profiles = await this.dependencies.profileReader.getProfiles();
    await this.applyProxyToProfiles(profiles, proxyUrl, '');
    await this.syncProxyConfiguration(proxyUrl);
  }

  async applyProxyForRunningProfiles(proxyUrl: string): Promise<void> {
    if (!this.dependencies.instanceDetector) {
      return;
    }

    const running =
      await this.dependencies.instanceDetector.detectRunningInstances();
    const profiles = await this.dependencies.profileReader.getProfiles();
    await this.applyProxyToProfiles(
      profiles.filter((profile) => running.has(profile.id)),
      proxyUrl,
      'running profile '
    );
    await this.syncProxyConfiguration(proxyUrl);
  }

  /** Applies a temporary proxy to one profile without touching window state. */
  async applyProxySettings(
    userDataDir: string,
    proxyUrl: string
  ): Promise<void> {
    await this.dependencies.profileSettingsManager.applyProxySettings(
      userDataDir,
      proxyUrl
    );
  }

  private async applyProxyToProfiles(
    profiles: readonly Profile[],
    proxyUrl: string,
    profilePrefix: string
  ): Promise<void> {
    for (const profile of profiles) {
      try {
        await this.applyProxySettings(profile.userDataDir, proxyUrl);
      } catch (error) {
        this.dependencies.warn(
          `[ProxySettings] Failed to apply proxy for ${profilePrefix}${profile.displayName}: ${formatError(error)}`
        );
      }
    }
  }

  private async syncProxyConfiguration(proxyUrl: string): Promise<void> {
    try {
      await this.dependencies.windowConfiguration.syncProxy(proxyUrl);
    } catch (error) {
      this.dependencies.warn(
        `[ProxySettings] Failed to sync proxy to active window: ${formatError(error)}`
      );
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
