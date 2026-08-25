import type { IInstanceDetector } from '../domain/ports/IInstanceDetector';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { RestoreAllProfilesResult } from '../domain/ports/IProxyLifecycle';
import type {
  IProfileSettingsManager,
  ProxyBackupInfo,
} from '../domain/ports/IProfileSettingsManager';
import * as extensionLog from '../logging/extensionLog';
import {
  clearProxyVscodeConfiguration,
  syncProxyVscodeConfiguration,
} from '../proxy/syncProxyVscodeConfiguration';

export type { RestoreAllProfilesResult };

/**
 * Application service: orchestrate proxy settings across all managed profiles.
 */
export class ProxySettingsService {
  constructor(
    private readonly profileManager: IProfileReader,
    private readonly profileSettingsManager: IProfileSettingsManager,
    private readonly instanceDetector?: IInstanceDetector
  ) {}

  /**
   * Write proxy to disk for every managed profile and sync the active window UI.
   */
  async applyProxyForAllProfiles(proxyUrl: string): Promise<void> {
    const profiles = await this.profileManager.getProfiles();
    for (const profile of profiles) {
      try {
        await this.profileSettingsManager.applyProxySettings(
          profile.userDataDir,
          proxyUrl
        );
      } catch (error) {
        extensionLog.warn(
          `[ProxySettings] Failed to apply proxy for ${profile.displayName}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    try {
      await syncProxyVscodeConfiguration(proxyUrl);
    } catch (error) {
      extensionLog.warn(
        `[ProxySettings] Failed to sync proxy to active window: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Apply proxy only to profiles that currently have a running Cursor instance.
   */
  async applyProxyForRunningProfiles(proxyUrl: string): Promise<void> {
    if (!this.instanceDetector) {
      return;
    }

    const running = await this.instanceDetector.detectRunningInstances();
    const profiles = await this.profileManager.getProfiles();

    for (const profile of profiles) {
      if (!running.has(profile.id)) {
        continue;
      }
      try {
        await this.profileSettingsManager.applyProxySettings(
          profile.userDataDir,
          proxyUrl
        );
      } catch (error) {
        extensionLog.warn(
          `[ProxySettings] Failed to apply proxy for running profile ${profile.displayName}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    try {
      await syncProxyVscodeConfiguration(proxyUrl);
    } catch (error) {
      extensionLog.warn(
        `[ProxySettings] Failed to sync proxy to active window: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

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

    try {
      await clearProxyVscodeConfiguration();
    } catch (error) {
      extensionLog.debug(
        `[ProxySettings] Failed to clear active window proxy config: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
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
