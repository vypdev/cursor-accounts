import type { ProfileQuota, ToWebviewMessage } from '@cursor-accounts/types';
import * as extensionLog from '../logging/extensionLog';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { ProfileGitHubEnrichmentService } from '../github/profileGitHubEnrichmentService';
import type { MultiProfileQuotaService } from '../services/multiProfileQuotaService';
import { quotaMapToRecord } from '../services/multiProfileQuotaService';
import type { ProfileAccountFetcher } from '../services/profileAccountFetcher';
import { accountMapToRecord } from '../services/profileAccountFetcher';
import type { ProfileWorkspaceService } from '../application/services/profileWorkspaceService';

export interface AccountsPanelBackgroundRefreshDependencies {
  profileManager: IProfileReader;
  profileDetector: IProfileDetector;
  quotaService: MultiProfileQuotaService;
  accountFetcher: ProfileAccountFetcher;
  profileWorkspaceService: ProfileWorkspaceService;
  githubEnrichment: ProfileGitHubEnrichmentService;
}

export interface AccountsPanelBackgroundRefreshCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
  hasActiveWebview(): boolean;
}

/** Coordinates remote panel refreshes without owning the panel read model. */
export class AccountsPanelBackgroundRefreshCoordinator {
  private accountsFetchInFlight = false;
  private githubFetchInFlight = false;

  constructor(
    private readonly dependencies: AccountsPanelBackgroundRefreshDependencies,
    private readonly callbacks: AccountsPanelBackgroundRefreshCallbacks
  ) {}

  async refreshProfileAccounts(): Promise<void> {
    if (!this.callbacks.hasActiveWebview()) {
      return;
    }

    if (this.accountsFetchInFlight) {
      extensionLog.debug(
        '[AccountsPanel] Profile account fetch skipped (already in flight)'
      );
      return;
    }

    try {
      this.accountsFetchInFlight = true;
      await this.callbacks.postMessage({ type: 'accountsLoading', data: true });

      const profiles = await this.dependencies.profileManager.getProfiles();
      const currentProfile =
        await this.dependencies.profileDetector.detectCurrentProfile();
      const userDataDir =
        this.dependencies.profileDetector.getCurrentUserDataDir();

      const [accountMap, activeAccount] = await Promise.all([
        this.dependencies.accountFetcher.fetchAllProfileAccounts(profiles),
        this.dependencies.accountFetcher.fetchActiveWindowAccount(
          userDataDir,
          currentProfile?.id
        ),
      ]);

      await this.callbacks.postMessage({
        type: 'profileAccounts',
        data: accountMapToRecord(accountMap),
      });
      await this.callbacks.postMessage({
        type: 'activeAccount',
        data: activeAccount,
      });
    } catch (error) {
      extensionLog.error(
        `[AccountsPanel] Failed to refresh profile accounts: ${extensionLog.formatError(error)}`
      );
    } finally {
      this.accountsFetchInFlight = false;
      await this.callbacks.postMessage({ type: 'accountsLoading', data: false });
    }
  }

  async refreshGithubSummaries(): Promise<void> {
    if (!this.callbacks.hasActiveWebview()) {
      return;
    }

    if (this.githubFetchInFlight) {
      extensionLog.debug(
        '[AccountsPanel] GitHub enrichment skipped (already in flight)'
      );
      return;
    }

    try {
      this.githubFetchInFlight = true;
      const profilesWithWorkspaces =
        await this.dependencies.profileWorkspaceService.getProfilesWithWorkspaces();
      const { summaries, tokenStatus } =
        await this.dependencies.githubEnrichment.enrichProfiles(
          profilesWithWorkspaces
        );

      await this.callbacks.postMessage({
        type: 'githubSummaries',
        data: { summaries, tokenStatus },
      });
    } catch (error) {
      extensionLog.error(
        `[AccountsPanel] Failed to refresh GitHub summaries: ${extensionLog.formatError(error)}`
      );
    } finally {
      this.githubFetchInFlight = false;
    }
  }

  async refreshQuotas(): Promise<void> {
    if (!this.callbacks.hasActiveWebview()) {
      return;
    }

    try {
      const quotaMap = await this.dependencies.quotaService.fetchAllQuotas();
      await this.postQuotas(quotaMap);
    } catch (error) {
      extensionLog.error(
        `[AccountsPanel] Failed to refresh quotas: ${extensionLog.formatError(error)}`
      );
    }
  }

  async postQuotas(quotas: Map<string, ProfileQuota>): Promise<void> {
    if (!this.callbacks.hasActiveWebview()) {
      return;
    }

    await this.callbacks.postMessage({
      type: 'quotas',
      data: quotaMapToRecord(quotas),
    });
  }
}
