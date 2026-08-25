import type {
  InstanceInfo,
  Profile,
  ProfileQuota,
  ProfileWithWorkspaces,
  ProxyStatus,
  ToWebviewMessage,
  WorkspaceInfo,
} from '@cursor-accounts/types';
import * as extensionLog from '../logging/extensionLog';
import { getLocale, getWebviewMessages, t } from '../l10n';
import type { IInstanceDetector } from '../domain/ports/IInstanceDetector';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IProxyManager } from '../domain/ports/IProxyManager';
import type { EfficiencyService } from '../modelEfficiency/efficiencyService';
import type { AccountsPanelBackgroundRefreshCoordinator } from './accountsPanelBackgroundRefreshCoordinator';
import {
  getOpenProjectPathsForProfile,
  instanceMapToRecord,
} from '../profiles/instanceDetector';
import type { ProfileWorkspaceService } from '../services/profileWorkspaceService';
import {
  getOpenWorkspacePaths,
  isWorkspacePathOpen,
} from '../services/activeWorkspaceService';
import type { ProxySettingsService } from '../services/proxySettingsService';
import { isProfileProxyEnabled } from '@cursor-accounts/types';
import {
  quotaMapToRecord,
  type MultiProfileQuotaService,
} from '../services/multiProfileQuotaService';

export interface AccountsPanelDataRefresherDependencies {
  profileManager: IProfileManager;
  profileDetector: IProfileDetector;
  backgroundRefresh: AccountsPanelBackgroundRefreshCoordinator;
  quotaService: Pick<MultiProfileQuotaService, 'getAllCachedQuotas'>;
  instanceDetector: IInstanceDetector;
  profileWorkspaceService: ProfileWorkspaceService;
  efficiencyService: EfficiencyService;
  proxyManager: IProxyManager;
  proxySettingsService?: ProxySettingsService;
}

export interface AccountsPanelDataRefresherCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
  hasActiveWebview(): boolean;
}

/** Coordinates panel read models and refresh use cases without owning webview lifecycle. */
export class AccountsPanelDataRefresher {
  constructor(
    private readonly dependencies: AccountsPanelDataRefresherDependencies,
    private readonly callbacks: AccountsPanelDataRefresherCallbacks
  ) {}

  async refresh(): Promise<void> {
    if (!this.callbacks.hasActiveWebview()) {
      return;
    }

    try {
      const profiles = await this.dependencies.profileManager.getProfiles();
      const currentProfile =
        await this.dependencies.profileDetector.detectCurrentProfile();
      const cachedQuotas = this.dependencies.quotaService.getAllCachedQuotas();
      const quotas = quotaMapToRecord(cachedQuotas);
      const runningInstances = instanceMapToRecord(
        await this.dependencies.instanceDetector.detectRunningInstances()
      );

      const profilesWithWorkspaces =
        await this.dependencies.profileWorkspaceService.getProfilesWithWorkspaces();
      const openPaths = getOpenWorkspacePaths();
      const profileWorkspaces = this.buildProfileWorkspaces(
        profilesWithWorkspaces,
        currentProfile,
        openPaths,
        runningInstances
      );

      await this.callbacks.postMessage({
        type: 'init',
        data: {
          profiles,
          profileWorkspaces,
          currentProfile,
          quotas,
          profileAccounts: {},
          activeAccount: null,
          runningInstances,
          openWorkspacePaths: openPaths,
          profileGithubSummaries: {},
          profileGithubTokenStatus: {},
          efficiencyStats: this.dependencies.efficiencyService
            .getStatsStorage()
            .getAllStats(),
          proxyStatus: this.shouldShowProxyUi(currentProfile)
            ? await this.buildProxyStatus({ checkCertificate: true })
            : null,
          currentWindowUsesProxy: this.shouldShowProxyUi(currentProfile)
            ? await this.dependencies.proxyManager.isCurrentWindowUsingProxy()
            : false,
          profileProxyTemporary:
            await this.buildProfileProxyTemporary(currentProfile),
          locale: getLocale(),
          messages: getWebviewMessages(),
        },
      });

      void Promise.all([
        this.dependencies.backgroundRefresh.refreshQuotas(),
        this.dependencies.backgroundRefresh.refreshProfileAccounts(),
        this.dependencies.backgroundRefresh.refreshGithubSummaries(),
      ]);
    } catch (error) {
      extensionLog.error(
        `[AccountsPanel] Failed to refresh accounts panel: ${extensionLog.formatError(error)}`
      );
      await this.callbacks.postMessage({
        type: 'error',
        message: t('errors.failedLoadProfiles'),
      });
    }
  }

  async refreshOpenWorkspaces(): Promise<void> {
    if (!this.callbacks.hasActiveWebview()) {
      return;
    }

    try {
      const openPaths = getOpenWorkspacePaths();
      const currentProfile =
        await this.dependencies.profileDetector.detectCurrentProfile();
      const profilesWithWorkspaces =
        await this.dependencies.profileWorkspaceService.getProfilesWithWorkspaces();
      const runningInstances = instanceMapToRecord(
        this.dependencies.instanceDetector.getLastDetection()
      );
      const profileWorkspaces = this.buildProfileWorkspaces(
        profilesWithWorkspaces,
        currentProfile,
        openPaths,
        runningInstances
      );

      await this.callbacks.postMessage({
        type: 'openWorkspaces',
        data: { paths: openPaths, profileWorkspaces },
      });
    } catch (error) {
      extensionLog.error(
        `[AccountsPanel] Failed to refresh open workspaces: ${extensionLog.formatError(error)}`
      );
    }
  }

  async refreshProxyStatus(options?: {
    checkCertificate?: boolean;
  }): Promise<void> {
    if (!this.callbacks.hasActiveWebview()) {
      return;
    }

    const currentProfile =
      await this.dependencies.profileDetector.detectCurrentProfile();
    if (!this.shouldShowProxyUi(currentProfile)) {
      await this.callbacks.postMessage({ type: 'proxyStatus', data: null });
      await this.callbacks.postMessage({
        type: 'currentWindowProxyUsage',
        usesProxy: false,
      });
      return;
    }

    const proxyStatus = await this.buildProxyStatus(options);
    await this.callbacks.postMessage({ type: 'proxyStatus', data: proxyStatus });

    const usesProxy =
      await this.dependencies.proxyManager.isCurrentWindowUsingProxy();
    await this.callbacks.postMessage({
      type: 'currentWindowProxyUsage',
      usesProxy,
    });
  }

  async postEfficiencyStats(): Promise<void> {
    if (!this.callbacks.hasActiveWebview()) {
      return;
    }

    await this.callbacks.postMessage({
      type: 'efficiencyStats',
      data: this.dependencies.efficiencyService
        .getStatsStorage()
        .getAllStats(),
    });
  }

  async refreshInstances(): Promise<void> {
    if (!this.callbacks.hasActiveWebview()) {
      return;
    }

    try {
      const runningInstances =
        await this.dependencies.instanceDetector.detectRunningInstances();
      await this.postRunningInstances(runningInstances);
    } catch (error) {
      extensionLog.error(
        `[AccountsPanel] Failed to refresh instances: ${extensionLog.formatError(error)}`
      );
    }
  }

  async refreshProfileAccounts(): Promise<void> {
    await this.dependencies.backgroundRefresh.refreshProfileAccounts();
  }

  async refreshGithubSummaries(): Promise<void> {
    await this.dependencies.backgroundRefresh.refreshGithubSummaries();
  }

  async refreshQuotas(): Promise<void> {
    await this.dependencies.backgroundRefresh.refreshQuotas();
  }

  async postQuotas(quotas: Map<string, ProfileQuota>): Promise<void> {
    await this.dependencies.backgroundRefresh.postQuotas(quotas);
  }

  async postRunningInstances(
    instances: Map<string, InstanceInfo>
  ): Promise<void> {
    if (!this.callbacks.hasActiveWebview()) {
      return;
    }

    await this.callbacks.postMessage({
      type: 'runningInstances',
      data: instanceMapToRecord(instances),
    });
  }

  private shouldShowProxyUi(currentProfile: Profile | null): boolean {
    return currentProfile != null && isProfileProxyEnabled(currentProfile);
  }

  private async buildProfileProxyTemporary(
    currentProfile: Profile | null
  ): Promise<Record<string, boolean>> {
    if (
      !this.shouldShowProxyUi(currentProfile) ||
      !this.dependencies.proxySettingsService
    ) {
      return {};
    }

    const backupInfo =
      await this.dependencies.proxySettingsService.getAllProxyBackupInfo();
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

  private buildProfileWorkspaces(
    profilesWithWorkspaces: ProfileWithWorkspaces[],
    currentProfile: Profile | null,
    openPaths: string[],
    runningInstances: Record<string, InstanceInfo>
  ): Record<string, WorkspaceInfo[]> {
    const profileWorkspaces: Record<string, WorkspaceInfo[]> = {};

    for (const profile of profilesWithWorkspaces) {
      const openProjectPaths = getOpenProjectPathsForProfile(
        runningInstances,
        profile.id
      );

      profileWorkspaces[profile.id] = profile.workspaces.map((workspace) => ({
        ...workspace,
        isOpenInSession:
          (currentProfile?.id === profile.id &&
            isWorkspacePathOpen(workspace.path, openPaths)) ||
          openProjectPaths.some((openPath) =>
            isWorkspacePathOpen(workspace.path, [openPath])
          ),
      }));
    }

    return profileWorkspaces;
  }

  private async buildProxyStatus(options?: {
    checkCertificate?: boolean;
  }): Promise<ProxyStatus | null> {
    const currentProfile =
      await this.dependencies.profileDetector.detectCurrentProfile();
    if (!this.shouldShowProxyUi(currentProfile) || currentProfile == null) {
      return null;
    }

    const status = await this.dependencies.proxyManager.getStatus(
      currentProfile.id
    );
    if (!status) {
      return null;
    }

    let caCertificateInstalled: boolean | undefined;
    if (options?.checkCertificate) {
      caCertificateInstalled =
        await this.dependencies.proxyManager.checkCertificateInstalled();
    } else {
      caCertificateInstalled =
        this.dependencies.proxyManager.getCachedCertificateInstalled();
    }

    if (caCertificateInstalled === undefined) {
      return status;
    }

    return { ...status, caCertificateInstalled };
  }

}
