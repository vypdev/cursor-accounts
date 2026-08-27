import type { InitData } from '@cursor-accounts/types';
import type { IInstanceDetector } from '../domain/ports/IInstanceDetector';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { EfficiencyService } from '../modelEfficiency/efficiencyService';
import { getLocale, getWebviewMessages } from '../l10n';
import { instanceMapToRecord } from '../profiles/instanceDetector';
import type { ProfileWorkspaceService } from '../application/services/profileWorkspaceService';
import { getOpenWorkspacePaths } from '../services/activeWorkspaceService';
import {
  quotaMapToRecord,
  type MultiProfileQuotaService,
} from '../services/multiProfileQuotaService';
import { buildProfileWorkspaceMap } from './presentation/profileWorkspacePresentation';
import type { AccountsPanelProxyStateCoordinator } from './accountsPanelProxyStateCoordinator';

export interface AccountsPanelInitialDataReaderDependencies {
  profileManager: IProfileReader;
  profileDetector: IProfileDetector;
  quotaService: Pick<MultiProfileQuotaService, 'getAllCachedQuotas'>;
  instanceDetector: IInstanceDetector;
  profileWorkspaceService: ProfileWorkspaceService;
  efficiencyService: EfficiencyService;
  proxyState: AccountsPanelProxyStateCoordinator;
}

/** Builds the complete initial read model required by the accounts webview. */
export class AccountsPanelInitialDataReader {
  constructor(
    private readonly dependencies: AccountsPanelInitialDataReaderDependencies
  ) {}

  async read(): Promise<InitData> {
    const profiles = await this.dependencies.profileManager.getProfiles();
    const currentProfile =
      await this.dependencies.profileDetector.detectCurrentProfile();
    const quotas = quotaMapToRecord(
      this.dependencies.quotaService.getAllCachedQuotas()
    );
    const runningInstances = instanceMapToRecord(
      await this.dependencies.instanceDetector.detectRunningInstances()
    );
    const profilesWithWorkspaces =
      await this.dependencies.profileWorkspaceService.getProfilesWithWorkspaces();
    const openWorkspacePaths = getOpenWorkspacePaths();
    const profileWorkspaces = buildProfileWorkspaceMap(
      profilesWithWorkspaces,
      currentProfile,
      openWorkspacePaths,
      runningInstances
    );

    return {
      profiles,
      profileWorkspaces,
      currentProfile,
      quotas,
      profileAccounts: {},
      activeAccount: null,
      runningInstances,
      openWorkspacePaths,
      profileGithubSummaries: {},
      profileGithubTokenStatus: {},
      efficiencyStats: this.dependencies.efficiencyService
        .getStatsStorage()
        .getAllStats(),
      ...(await this.dependencies.proxyState.read(currentProfile, {
        checkCertificate: true,
      })),
      locale: getLocale(),
      messages: getWebviewMessages(),
    };
  }
}
