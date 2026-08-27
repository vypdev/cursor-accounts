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
import type { ProfileWorkspaceService } from '../application/services/profileWorkspaceService';
import type { ProfileGitHubEnrichmentService } from '../github/profileGitHubEnrichmentService';
import { AccountsPanelBackgroundRefreshCoordinator } from '../ui/accountsPanelBackgroundRefreshCoordinator';
import { AccountsPanelDataRefresher } from '../ui/accountsPanelDataRefresher';
import { AccountsPanelInitialDataReader } from '../ui/accountsPanelInitialDataReader';
import { AccountsPanelProxyStateCoordinator } from '../ui/accountsPanelProxyStateCoordinator';

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
  const profileManager = {
    getProfiles: async () => [PROFILE],
  } as unknown as IProfileManager;
  const profileDetector = {
    detectCurrentProfile: async () => null,
    getCurrentUserDataDir: () => '/tmp/cursor-user',
  } as unknown as IProfileDetector;
  const quotaService = {
    getAllCachedQuotas: () => new Map(),
    fetchAllQuotas: async () => new Map(),
  } as unknown as MultiProfileQuotaService;
  const accountFetcher = {
    fetchAllProfileAccounts: async () => new Map(),
    fetchActiveWindowAccount: async () => null,
  } as unknown as ProfileAccountFetcher;
  const profileWorkspaceService = {
    getProfilesWithWorkspaces: async () => [],
  } as unknown as ProfileWorkspaceService;
  const githubEnrichment = {
    enrichProfiles: async () => ({ summaries: {}, tokenStatus: {} }),
  } as unknown as ProfileGitHubEnrichmentService;
  const callbacks = {
    postMessage: async (message: ToWebviewMessage) => {
      postedMessages.push(message);
    },
    hasActiveWebview: () => active,
  };
  const proxyManager = {
    isCurrentWindowUsingProxy: async () => false,
    getStatus: async () => null,
    checkCertificateInstalled: async () => false,
    getCachedCertificateInstalled: () => false,
    getProxyServerUrl: async () => null,
  } as unknown as IProxyManager;
  const proxyState = new AccountsPanelProxyStateCoordinator(
    { profileDetector, proxyManager },
    callbacks
  );
  const instanceDetector = {
    detectRunningInstances: async () => new Map(),
    getLastDetection: () => new Map(),
  } as unknown as IInstanceDetector;
  const efficiencyService = {
    getStatsStorage: () => ({ getAllStats: () => ({}) }),
  } as unknown as EfficiencyService;
  const backgroundRefresh = new AccountsPanelBackgroundRefreshCoordinator(
    {
      profileManager,
      profileDetector,
      quotaService,
      accountFetcher,
      profileWorkspaceService,
      githubEnrichment,
    },
    callbacks
  );
  const refresher = new AccountsPanelDataRefresher(
    {
      profileDetector,
      backgroundRefresh,
      instanceDetector,
      profileWorkspaceService,
      efficiencyService,
      initialDataReader: new AccountsPanelInitialDataReader({
        profileManager,
        profileDetector,
        quotaService,
        instanceDetector,
        profileWorkspaceService,
        efficiencyService,
        proxyState,
      }),
      proxyState,
    },
    callbacks
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
