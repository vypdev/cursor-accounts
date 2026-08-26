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
      enabledModels: [],
    });
    expect(state.showPricesModal).toBe(true);
    expect(state.pricingLoading).toBe(false);

    state = applyMessage(state, { type: 'error', message: 'Failure' });
    state = appMessageReducer(state, { type: 'clearError' });
    state = appMessageReducer(state, { type: 'closeModelPricing' });
    expect(state.error).toBeNull();
    expect(state.showPricesModal).toBe(false);
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
