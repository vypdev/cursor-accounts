import type {
  InstanceInfo,
  ProfileQuota,
  ToWebviewMessage,
} from '@cursor-accounts/types';
import * as extensionLog from '../logging/extensionLog';
import { t } from '../l10n';
import type { EfficiencyService } from '../modelEfficiency/efficiencyService';
import type { AccountsPanelBackgroundRefreshCoordinator } from './accountsPanelBackgroundRefreshCoordinator';
import type { AccountsPanelInitialDataReader } from './accountsPanelInitialDataReader';
import type { AccountsPanelProxyStateCoordinator } from './accountsPanelProxyStateCoordinator';
import type { AccountsPanelWorkspaceStateCoordinator } from './accountsPanelWorkspaceStateCoordinator';

export interface AccountsPanelDataRefresherDependencies {
  backgroundRefresh: AccountsPanelBackgroundRefreshCoordinator;
  efficiencyService: EfficiencyService;
  initialDataReader: AccountsPanelInitialDataReader;
  proxyState: AccountsPanelProxyStateCoordinator;
  workspaceState: AccountsPanelWorkspaceStateCoordinator;
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
    await this.dependencies.workspaceState.refreshOpenWorkspaces();
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
    await this.dependencies.workspaceState.refreshInstances();
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
    await this.dependencies.workspaceState.postRunningInstances(instances);
  }

}
