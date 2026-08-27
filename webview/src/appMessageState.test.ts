import { describe, expect, it } from 'vitest';
import {
  appMessageReducer,
  createInitialAppMessageState,
  type AppMessageState,
} from './appMessageState';
import type {
  InitData,
  Profile,
  StorageBreakdown,
  StorageCleanupResult,
  ToWebviewMessage,
} from './types';

const profile: Profile = {
  id: 'profile-1',
  email: 'user@example.com',
  slug: 'user-example-com',
  displayName: 'User',
  userDataDir: '/tmp/profile-1',
  created: '2026-08-26T00:00:00.000Z',
};

const initData: InitData = {
  profiles: [profile],
  profileWorkspaces: {},
  currentProfile: profile,
  quotas: {},
  profileAccounts: {},
  activeAccount: null,
  runningInstances: {},
  openWorkspacePaths: [],
  profileGithubSummaries: {},
  profileGithubTokenStatus: {},
  efficiencyStats: {},
  proxyStatus: null,
  currentWindowUsesProxy: false,
  profileProxyTemporary: {},
  locale: 'en',
  messages: {},
};

const translate = (
  key: string,
  args?: Record<string, string | number | undefined>
): string => `${key}:${args?.error ?? ''}`;

function applyMessage(
  state: AppMessageState,
  message: ToWebviewMessage,
  storageProfileId: string | null = null
): AppMessageState {
  return appMessageReducer(state, {
    type: 'message',
    message,
    storageProfileId,
    translate,
  });
}

describe('appMessageReducer', () => {
  it('creates deterministic initial state for host-owned data', () => {
    const state = createInitialAppMessageState();

    expect(state.loading).toBe(true);
    expect(state.profiles).toEqual([]);
    expect(state.showPricesModal).toBe(false);
  });

  it('hydrates all host-owned state from the init message', () => {
    const state = applyMessage(createInitialAppMessageState(), {
      type: 'init',
      data: initData,
    });

    expect(state.profiles).toEqual([profile]);
    expect(state.currentProfile).toEqual(profile);
    expect(state.loading).toBe(false);
    expect(state.proxyStatus).toBeNull();
    expect(state.currentWindowUsesProxy).toBe(false);
  });

  it('uses safe defaults when optional init projections are absent', () => {
    const state = applyMessage(createInitialAppMessageState(), {
      type: 'init',
      data: {
        ...initData,
        quotas: undefined,
        profileAccounts: undefined,
        activeAccount: undefined,
        runningInstances: undefined,
        profileWorkspaces: undefined,
        openWorkspacePaths: undefined,
        profileGithubSummaries: undefined,
        profileGithubTokenStatus: undefined,
        efficiencyStats: undefined,
        proxyStatus: undefined,
        profileProxyTemporary: undefined,
        currentWindowUsesProxy: undefined,
      } as unknown as InitData,
    });

    expect(state.quotas).toEqual({});
    expect(state.activeAccount).toBeNull();
    expect(state.runningInstances).toEqual({});
    expect(state.openWorkspacePaths).toEqual([]);
    expect(state.proxyStatus).toBeNull();
    expect(state.currentWindowUsesProxy).toBe(false);
  });

  it('applies incremental profile, account, workspace, proxy, and efficiency updates', () => {
    let state = createInitialAppMessageState();
    state = applyMessage(state, { type: 'profiles', data: [profile] });
    state = applyMessage(state, {
      type: 'currentWindowProxyUsage',
      usesProxy: true,
    });
    state = applyMessage(state, {
      type: 'openWorkspaces',
      data: { paths: ['/workspace'], profileWorkspaces: {} },
    });
    state = applyMessage(state, { type: 'accountsLoading', data: true });
    state = applyMessage(state, { type: 'efficiencyStats', data: {} });

    expect(state.profiles).toEqual([profile]);
    expect(state.currentWindowUsesProxy).toBe(true);
    expect(state.openWorkspacePaths).toEqual(['/workspace']);
    expect(state.accountsLoading).toBe(true);
  });

  it('translates certificate outcomes while keeping host error text out of success state', () => {
    let state = createInitialAppMessageState();
    state = applyMessage(state, {
      type: 'certificateInstallResult',
      success: true,
    });
    expect(state.success).toBe('proxy.install.installSuccess:');
    expect(state.error).toBeNull();

    state = applyMessage(state, {
      type: 'certificateInstallResult',
      success: false,
      error: 'permission denied',
    });
    expect(state.success).toBeNull();
    expect(state.error).toBe('proxy.install.installFailed:permission denied');

    state = applyMessage(state, {
      type: 'certificateUninstallResult',
      success: false,
      error: 'Linux requires manual removal',
    });
    expect(state.error).toBe('proxy.uninstall.linuxManual:');
  });

  it('handles proxy status, install-guide, and non-Linux certificate transitions', () => {
    let state = applyMessage(createInitialAppMessageState(), {
      type: 'error',
      message: 'Certificate is missing',
    });
    state = applyMessage(state, {
      type: 'currentWindowProxyUsage',
      usesProxy: true,
    });
    state = applyMessage(state, {
      type: 'proxyInstallGuide',
      data: {
        platform: 'darwin',
        certAvailable: true,
        certPath: '/tmp/ca.pem',
        title: 'Install certificate',
        intro: 'Install the local certificate.',
        steps: [],
      },
    });
    state = applyMessage(state, {
      type: 'proxyStatus',
      data: { running: false, caCertificateInstalled: false },
    });
    expect(state.currentWindowUsesProxy).toBe(true);
    expect(state.installGuide?.certPath).toBe('/tmp/ca.pem');
    expect(state.error).toBe('Certificate is missing');

    state = applyMessage(state, {
      type: 'certificateUninstallResult',
      success: false,
      error: 'permission denied',
    });
    expect(state.error).toBe('proxy.uninstall.failed:permission denied');
    state = applyMessage(state, {
      type: 'certificateUninstallResult',
      success: true,
    });
    expect(state.success).toBe('proxy.uninstall.success:');

    const uninstallUnchanged = applyMessage(state, {
      type: 'certificateUninstallResult',
      success: false,
    });
    expect(uninstallUnchanged).toBe(state);

    const unchanged = applyMessage(state, {
      type: 'certificateInstallResult',
      success: false,
    });
    expect(unchanged).toBe(state);

    state = applyMessage(state, {
      type: 'proxyStatus',
      data: { running: false, caCertificateInstalled: true },
    });
    expect(state.error).toBeNull();
  });

  it('applies remaining host projections and suggested notices', () => {
    let state = createInitialAppMessageState();
    state = applyMessage(state, { type: 'quotas', data: {} });
    state = applyMessage(state, { type: 'profileAccounts', data: {} });
    state = applyMessage(state, { type: 'activeAccount', data: null });
    state = applyMessage(state, { type: 'runningInstances', data: {} });
    state = applyMessage(state, { type: 'currentProfile', data: null });
    state = applyMessage(state, {
      type: 'githubSummaries',
      data: { summaries: {}, tokenStatus: {} },
    });
    state = applyMessage(state, {
      type: 'suggestedProfile',
      notice: 'Already configured',
    });
    state = applyMessage(state, {
      type: 'exportData',
      data: '{}',
      filename: 'profiles.json',
    });

    expect(state.profileAccounts).toEqual({});
    expect(state.activeAccount).toBeNull();
    expect(state.suggestedNotice).toBe('Already configured');
    expect(state.suggestedEmail).toBeUndefined();
  });

  it('ignores storage responses for another profile and accepts the active profile', () => {
    const storageInfo = {
      profileId: 'profile-1',
      totalBytes: 100,
    } as StorageBreakdown;
    const cleanupResult = {
      success: true,
      message: 'Cleaned',
    } as StorageCleanupResult;
    let state = createInitialAppMessageState();

    state = applyMessage(
      state,
      { type: 'storageInfo', data: storageInfo },
      'profile-2'
    );
    expect(state.storageInfo).toBeUndefined();

    state = applyMessage(
      state,
      { type: 'storageInfo', data: storageInfo },
      'profile-1'
    );
    state = applyMessage(
      state,
      { type: 'storageCleanupResult', data: cleanupResult },
      'profile-1'
    );
    expect(state.storageInfo).toEqual(storageInfo);
    expect(state.lastCleanupResult).toEqual(cleanupResult);
    expect(state.success).toBe('Cleaned');

    state = applyMessage(
      state,
      {
        type: 'storageCleanupResult',
        data: { success: false, message: 'Cleanup failed' } as StorageCleanupResult,
      },
      'profile-1'
    );
    expect(state.success).toBeNull();
    expect(state.error).toBe('Cleanup failed');

    const withoutStorageProfile = applyMessage(
      state,
      {
        type: 'storageCleanupResult',
        data: cleanupResult,
      }
    );
    expect(withoutStorageProfile).toBe(state);
  });

  it('handles suggestions, pricing transitions, notifications, and reset actions', () => {
    let state = createInitialAppMessageState();
    state = applyMessage(state, {
      type: 'suggestedProfile',
      email: 'suggested@example.com',
      displayName: 'Suggested',
    });
    expect(state.suggestedEmail).toBe('suggested@example.com');

    state = appMessageReducer(state, { type: 'clearSuggestedProfile' });
    state = appMessageReducer(state, { type: 'beginModelPricingRequest' });
    expect(state.showPricesModal).toBe(true);
    expect(state.pricingLoading).toBe(true);

    state = applyMessage(state, {
      type: 'modelPricing',
      data: [],
    });
    expect(state.showPricesModal).toBe(true);
    expect(state.pricingLoading).toBe(false);

    state = applyMessage(state, { type: 'error', message: 'Failure' });
    state = appMessageReducer(state, { type: 'clearError' });
    state = appMessageReducer(state, { type: 'clearSuccess' });
    state = appMessageReducer(state, { type: 'clearInstallGuide' });
    state = appMessageReducer(state, { type: 'resetStorageMessageState' });
    state = applyMessage(state, {
      type: 'modelPricingError',
      error: 'Pricing unavailable',
    });
    state = appMessageReducer(state, { type: 'clearError' });
    state = appMessageReducer(state, { type: 'closeModelPricing' });
    expect(state.error).toBeNull();
    expect(state.showPricesModal).toBe(false);
    expect(state.installGuide).toBeNull();
    expect(state.storageInfo).toBeUndefined();
  });

  it('clears an existing error when certificate installation is confirmed by proxy status', () => {
    let state = applyMessage(createInitialAppMessageState(), {
      type: 'error',
      message: 'Certificate is missing',
    });
    state = applyMessage(state, {
      type: 'proxyStatus',
      data: { running: false, caCertificateInstalled: true },
    });

    expect(state.error).toBeNull();
  });
});
