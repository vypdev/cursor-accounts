import type {
  InstanceInfo,
  ProfileQuota,
  ToWebviewMessage,
} from '@cursor-accounts/types';
import * as extensionLog from '../logging/extensionLog';
import { t } from '../l10n';
import type { IInstanceDetector } from '../domain/ports/IInstanceDetector';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { EfficiencyService } from '../modelEfficiency/efficiencyService';
import type { AccountsPanelBackgroundRefreshCoordinator } from './accountsPanelBackgroundRefreshCoordinator';
import { instanceMapToRecord } from '../profiles/instanceDetector';
import type { ProfileWorkspaceService } from '../application/services/profileWorkspaceService';
import { getOpenWorkspacePaths } from '../services/activeWorkspaceService';
import { buildProfileWorkspaceMap } from './presentation/profileWorkspacePresentation';
import type { AccountsPanelInitialDataReader } from './accountsPanelInitialDataReader';
import type { AccountsPanelProxyStateCoordinator } from './accountsPanelProxyStateCoordinator';

export interface AccountsPanelDataRefresherDependencies {
  profileDetector: IProfileDetector;
  backgroundRefresh: AccountsPanelBackgroundRefreshCoordinator;
  instanceDetector: IInstanceDetector;
  profileWorkspaceService: ProfileWorkspaceService;
  efficiencyService: EfficiencyService;
  initialDataReader: AccountsPanelInitialDataReader;
  proxyState: AccountsPanelProxyStateCoordinator;
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
      const data = await this.dependencies.initialDataReader.read();
      await this.callbacks.postMessage({
        type: 'init',
        data,
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
      const profileWorkspaces = buildProfileWorkspaceMap(
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
    await this.dependencies.proxyState.refresh(options);
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

}
