import './registerVscodeMock';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile, ToWebviewMessage } from '@cursor-accounts/types';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { ProfileGitHubEnrichmentService } from '../github/profileGitHubEnrichmentService';
import type { MultiProfileQuotaService } from '../services/multiProfileQuotaService';
import type { ProfileAccountFetcher } from '../services/profileAccountFetcher';
import type { ProfileWorkspaceService } from '../services/profileWorkspaceService';
import { AccountsPanelBackgroundRefreshCoordinator } from '../ui/accountsPanelBackgroundRefreshCoordinator';

const PROFILE: Profile = {
  id: 'p1',
  email: 'user@example.com',
  slug: 'user',
  displayName: 'User',
  userDataDir: '/tmp/cursor-user',
  created: '2024-01-01T00:00:00.000Z',
};

function createCoordinator(active = true) {
  const postedMessages: ToWebviewMessage[] = [];
  const dependencies = {
    profileManager: {
      getProfiles: async () => [PROFILE],
    } as unknown as IProfileManager,
    profileDetector: {
      detectCurrentProfile: async () => null,
      getCurrentUserDataDir: () => PROFILE.userDataDir,
    } as unknown as IProfileDetector,
    quotaService: {
      getAllCachedQuotas: () => new Map(),
      fetchAllQuotas: async () => new Map(),
    } as unknown as MultiProfileQuotaService,
    accountFetcher: {
      fetchAllProfileAccounts: async () => new Map(),
      fetchActiveWindowAccount: async () => null,
    } as unknown as ProfileAccountFetcher,
    profileWorkspaceService: {
      getProfilesWithWorkspaces: async () => [],
    } as unknown as ProfileWorkspaceService,
    githubEnrichment: {
      enrichProfiles: async () => ({ summaries: {}, tokenStatus: {} }),
    } as unknown as ProfileGitHubEnrichmentService,
  };
  const coordinator = new AccountsPanelBackgroundRefreshCoordinator(
    dependencies,
    {
      postMessage: async (message) => {
        postedMessages.push(message);
      },
      hasActiveWebview: () => active,
    }
  );

  return { coordinator, dependencies, postedMessages };
}

describe('AccountsPanelBackgroundRefreshCoordinator', () => {
  it('does not query or post while the webview is inactive', async () => {
    const { coordinator, postedMessages } = createCoordinator(false);

    await coordinator.refreshProfileAccounts();
    await coordinator.refreshGithubSummaries();
    await coordinator.refreshQuotas();
    await coordinator.postQuotas(new Map());

    assert.deepEqual(postedMessages, []);
  });

  it('publishes account loading state and both account projections', async () => {
    const { coordinator, dependencies, postedMessages } = createCoordinator();
    const profileAccounts = new Map([
      ['p1', { profileId: 'p1', accountName: 'User', fetchedAt: 1 }],
    ]);
    const activeAccount = {
      profileId: 'p1',
      accountName: 'Active user',
      fetchedAt: 1,
    };
    dependencies.accountFetcher.fetchAllProfileAccounts = async () =>
      profileAccounts;
    dependencies.accountFetcher.fetchActiveWindowAccount = async () =>
      activeAccount;

    await coordinator.refreshProfileAccounts();

    assert.deepEqual(postedMessages, [
      { type: 'accountsLoading', data: true },
      { type: 'profileAccounts', data: { p1: profileAccounts.get('p1') } },
      { type: 'activeAccount', data: activeAccount },
      { type: 'accountsLoading', data: false },
    ]);
  });

  it('publishes GitHub summaries and quota records', async () => {
    const { coordinator, dependencies, postedMessages } = createCoordinator();
    const githubResult = {
      summaries: { p1: {} },
      tokenStatus: { p1: 'not_configured' as const },
    };
    const quotas = new Map([
      ['p1', { profileId: 'p1', quota: null, fetchedAt: 1 }],
    ]);
    dependencies.githubEnrichment.enrichProfiles = async () => githubResult;
    dependencies.quotaService.fetchAllQuotas = async () => quotas;

    await coordinator.refreshGithubSummaries();
    await coordinator.refreshQuotas();

    assert.deepEqual(postedMessages, [
      { type: 'githubSummaries', data: githubResult },
      { type: 'quotas', data: { p1: quotas.get('p1') } },
    ]);
  });

  it('releases the account lock after a failed fetch', async () => {
    const { coordinator, dependencies, postedMessages } = createCoordinator();
    dependencies.accountFetcher.fetchAllProfileAccounts = async () => {
      throw new Error('temporary failure');
    };

    await assert.doesNotReject(() => coordinator.refreshProfileAccounts());
    dependencies.accountFetcher.fetchAllProfileAccounts = async () => new Map();
    await coordinator.refreshProfileAccounts();

    assert.equal(
      postedMessages.filter((message) => message.type === 'accountsLoading')
        .length,
      4
    );
  });
});
