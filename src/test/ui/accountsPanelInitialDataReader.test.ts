import '../registerVscodeMock';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  InstanceInfo,
  Profile,
  ProfileQuota,
  ProfileWithWorkspaces,
} from '@cursor-accounts/types';
import type { IInstanceDetector } from '../../domain/ports/IInstanceDetector';
import type { IProfileDetector } from '../../domain/ports/IProfileDetector';
import type { IProfileReader } from '../../domain/ports/IProfileReader';
import type { EfficiencyService } from '../../modelEfficiency/efficiencyService';
import type { ProfileWorkspaceService } from '../../application/services/profileWorkspaceService';
import type { MultiProfileQuotaService } from '../../services/multiProfileQuotaService';
import type { AccountsPanelProxyStateCoordinator } from '../../ui/accountsPanelProxyStateCoordinator';
import { initL10nForTests } from '../../l10n';
import { AccountsPanelInitialDataReader } from '../../ui/accountsPanelInitialDataReader';

const PROFILE: Profile = {
  id: 'p1',
  email: 'user@example.com',
  slug: 'user',
  displayName: 'User',
  userDataDir: '/tmp/cursor-user',
  created: '2024-01-01T00:00:00.000Z',
};

const QUOTA: ProfileQuota = {
  profileId: PROFILE.id,
  quota: null,
  fetchedAt: 1,
};

const INSTANCE: InstanceInfo = {
  profileId: PROFILE.id,
  pid: 123,
  userDataDir: PROFILE.userDataDir,
  detectedAt: 1,
};

describe('AccountsPanelInitialDataReader', () => {
  initL10nForTests({ 'errors.failedLoadProfiles': 'Failed to load profiles' });

  it('builds the complete initial read model from its injected boundaries', async () => {
    const currentProfile = PROFILE;
    const profilesWithWorkspaces: ProfileWithWorkspaces[] = [
      { ...PROFILE, workspaces: [] },
    ];
    let requestedProfile: Profile | null | undefined;
    let requestedOptions: { checkCertificate?: boolean } | undefined;
    const proxyState = {
      read: async (
        profile: Profile | null,
        options: { checkCertificate?: boolean }
      ) => {
        requestedProfile = profile;
        requestedOptions = options;
        return {
          proxyStatus: null,
          currentWindowUsesProxy: false,
          profileProxyTemporary: {},
        };
      },
    } as unknown as AccountsPanelProxyStateCoordinator;
    const reader = new AccountsPanelInitialDataReader({
      profileManager: {
        getProfiles: async () => [PROFILE],
      } as unknown as IProfileReader,
      profileDetector: {
        detectCurrentProfile: async () => currentProfile,
      } as unknown as IProfileDetector,
      quotaService: {
        getAllCachedQuotas: () => new Map([[PROFILE.id, QUOTA]]),
      } as unknown as Pick<MultiProfileQuotaService, 'getAllCachedQuotas'>,
      instanceDetector: {
        detectRunningInstances: async () => new Map([[PROFILE.id, INSTANCE]]),
      } as unknown as IInstanceDetector,
      profileWorkspaceService: {
        getProfilesWithWorkspaces: async () => profilesWithWorkspaces,
      } as unknown as ProfileWorkspaceService,
      efficiencyService: {
        getStatsStorage: () => ({ getAllStats: () => ({}) }),
      } as unknown as EfficiencyService,
      proxyState,
    });

    const data = await reader.read();

    assert.deepEqual(data.profiles, [PROFILE]);
    assert.deepEqual(data.currentProfile, PROFILE);
    assert.deepEqual(data.quotas, { [PROFILE.id]: QUOTA });
    assert.deepEqual(data.runningInstances, { [PROFILE.id]: INSTANCE });
    assert.deepEqual(data.profileWorkspaces, { [PROFILE.id]: [] });
    assert.deepEqual(data.profileAccounts, {});
    assert.equal(data.activeAccount, null);
    assert.deepEqual(data.profileGithubSummaries, {});
    assert.deepEqual(data.profileGithubTokenStatus, {});
    assert.deepEqual(data.efficiencyStats, {});
    assert.equal(data.proxyStatus, null);
    assert.equal(data.currentWindowUsesProxy, false);
    assert.deepEqual(data.profileProxyTemporary, {});
    assert.deepEqual(data.openWorkspacePaths, []);
    assert.equal(requestedProfile, currentProfile);
    assert.deepEqual(requestedOptions, { checkCertificate: true });
    assert.equal(typeof data.locale, 'string');
    assert.equal(typeof data.messages, 'object');
  });
});
