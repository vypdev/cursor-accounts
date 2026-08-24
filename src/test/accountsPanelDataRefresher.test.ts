import './registerVscodeMock';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IInstanceDetector } from '../domain/ports/IInstanceDetector';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IProxyManager } from '../domain/ports/IProxyManager';
import type { EfficiencyService } from '../modelEfficiency/efficiencyService';
import { initL10nForTests } from '../l10n';
import type { Profile, ToWebviewMessage } from '../profiles/types';
import type { ProfileAccountFetcher } from '../services/profileAccountFetcher';
import type { MultiProfileQuotaService } from '../services/multiProfileQuotaService';
import type { ProfileWorkspaceService } from '../services/profileWorkspaceService';
import type { ProfileGitHubEnrichmentService } from '../github/profileGitHubEnrichmentService';
import { AccountsPanelDataRefresher } from '../ui/accountsPanelDataRefresher';

const PROFILE: Profile = {
  id: 'p1',
  email: 'user@example.com',
  slug: 'user',
  displayName: 'User',
  userDataDir: '/tmp/cursor-user',
  created: '2024-01-01T00:00:00.000Z',
};

function createRefresher(active = true) {
  const postedMessages: ToWebviewMessage[] = [];
  const refresher = new AccountsPanelDataRefresher(
    {
      profileManager: {
        getProfiles: async () => [PROFILE],
      } as unknown as IProfileManager,
      profileDetector: {
        detectCurrentProfile: async () => null,
        getCurrentUserDataDir: () => '/tmp/cursor-user',
      } as unknown as IProfileDetector,
      quotaService: {
        getAllCachedQuotas: () => new Map(),
        fetchAllQuotas: async () => new Map(),
      } as unknown as MultiProfileQuotaService,
      accountFetcher: {
        fetchAllProfileAccounts: async () => new Map(),
        fetchActiveWindowAccount: async () => null,
      } as unknown as ProfileAccountFetcher,
      instanceDetector: {
        detectRunningInstances: async () => new Map(),
        getLastDetection: () => new Map(),
      } as unknown as IInstanceDetector,
      profileWorkspaceService: {
        getProfilesWithWorkspaces: async () => [],
      } as unknown as ProfileWorkspaceService,
      efficiencyService: {
        getStatsStorage: () => ({ getAllStats: () => ({}) }),
      } as unknown as EfficiencyService,
      proxyManager: {
        isCurrentWindowUsingProxy: async () => false,
        getStatus: async () => null,
        checkCertificateInstalled: async () => false,
        getCachedCertificateInstalled: () => false,
      } as unknown as IProxyManager,
      githubEnrichment: {
        enrichProfiles: async () => ({ summaries: {}, tokenStatus: {} }),
      } as unknown as ProfileGitHubEnrichmentService,
    },
    {
      postMessage: async (message) => {
        postedMessages.push(message);
      },
      hasActiveWebview: () => active,
    }
  );

  return { refresher, postedMessages };
}

describe('AccountsPanelDataRefresher', () => {
  initL10nForTests({
    'errors.failedLoadProfiles': 'Failed to load profiles',
  });

  it('does not query or post when the webview is inactive', async () => {
    const { refresher, postedMessages } = createRefresher(false);

    await refresher.refresh();
    await refresher.refreshProfileAccounts();
    await refresher.refreshGithubSummaries();
    await refresher.refreshQuotas();

    assert.deepEqual(postedMessages, []);
  });

  it('posts the initial read model and starts secondary refreshes', async () => {
    const { refresher, postedMessages } = createRefresher();

    await refresher.refresh();
    await new Promise((resolve) => setImmediate(resolve));

    const initMessage = postedMessages.find((message) => message.type === 'init');
    assert.ok(initMessage);
    if (initMessage?.type === 'init') {
      assert.deepEqual(initMessage.data.profiles, [PROFILE]);
      assert.deepEqual(initMessage.data.runningInstances, {});
      assert.deepEqual(initMessage.data.profileAccounts, {});
    }
    assert.ok(postedMessages.some((message) => message.type === 'accountsLoading'));
    assert.ok(postedMessages.some((message) => message.type === 'githubSummaries'));
    assert.ok(postedMessages.some((message) => message.type === 'quotas'));
  });

  it('publishes empty proxy state for a window without a managed profile', async () => {
    const { refresher, postedMessages } = createRefresher();

    await refresher.refreshProxyStatus({ checkCertificate: true });

    assert.deepEqual(postedMessages, [
      { type: 'proxyStatus', data: null },
      { type: 'currentWindowProxyUsage', usesProxy: false },
    ]);
  });
});
