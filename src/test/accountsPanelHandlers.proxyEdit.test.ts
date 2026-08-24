import './registerVscodeMock';
import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';
import { initL10nForTests } from '../l10n';
import type { ProfileDetector } from '../profiles/profileDetector';
import type { ProfileManager } from '../profiles/profileManager';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import type { IProxyManager } from '../domain/ports/IProxyManager';
import { AccountsPanelHandlers } from '../ui/accountsPanelHandlers';

const CURRENT_PROFILE = {
  id: 'p1',
  email: 'user@example.com',
  slug: 'user',
  displayName: 'User',
  userDataDir: '/home/user/.cursor-user',
  created: '2024-01-01T00:00:00.000Z',
  proxyEnabled: true,
};

describe('AccountsPanelHandlers proxy edit', () => {
  beforeEach(() => {
    initL10nForTests({
      'panel.profileUpdated': 'Updated {name}',
    });
  });

  it('stops proxy and restores settings when proxy is disabled on edit', async () => {
    const stop = mock.fn(async () => undefined);
    const restoreProxySettings = mock.fn(async () => undefined);
    const updateProfile = mock.fn(async () => ({
      ...CURRENT_PROFILE,
      proxyEnabled: false,
    }));
    let refreshProxyCalled = false;

    const handlers = new AccountsPanelHandlers(
      {
        profileManager: {
          getProfile: async () => CURRENT_PROFILE,
          updateProfile,
        } as unknown as ProfileManager,
        profileLauncher: {} as never,
        profileDetector: {
          detectCurrentProfile: async () => CURRENT_PROFILE,
        } as ProfileDetector,
        efficiencyService: {} as never,
        authReader: {} as never,
        instanceDetector: {} as never,
        storageCleanupService: {} as never,
        storageAnalyzer: {} as never,
        profileWorkspaceService: {} as never,
        proxyManager: {
          stop,
          ensureProfileProxy: async () => ({ success: true, port: 8080 }),
        } as unknown as IProxyManager,
        profileSettingsManager: {
          restoreProxySettings,
        } as unknown as IProfileSettingsManager,
      },
      {
        postMessage: async () => undefined,
        refresh: async () => undefined,
        refreshInstances: async () => undefined,
        refreshGithubSummaries: async () => undefined,
        refreshProxyStatus: async () => {
          refreshProxyCalled = true;
        },
        hasActiveWebview: () => true,
      }
    );

    await handlers.handle({
      type: 'edit',
      profileId: 'p1',
      updates: { proxyEnabled: false },
    });

    assert.equal(stop.mock.callCount(), 1);
    assert.deepEqual(stop.mock.calls[0]?.arguments, ['p1']);
    assert.equal(restoreProxySettings.mock.callCount(), 1);
    assert.deepEqual(restoreProxySettings.mock.calls[0]?.arguments, [
      CURRENT_PROFILE.userDataDir,
    ]);
    assert.equal(refreshProxyCalled, true);
  });

  it('ensures profile proxy when re-enabled for the current window', async () => {
    const ensureProfileProxy = mock.fn(async () => ({ success: true, port: 8080 }));

    const handlers = new AccountsPanelHandlers(
      {
        profileManager: {
          getProfile: async () => CURRENT_PROFILE,
          updateProfile: async () => ({
            ...CURRENT_PROFILE,
            proxyEnabled: true,
          }),
        } as unknown as ProfileManager,
        profileLauncher: {} as never,
        profileDetector: {
          detectCurrentProfile: async () => CURRENT_PROFILE,
        } as ProfileDetector,
        efficiencyService: {} as never,
        authReader: {} as never,
        instanceDetector: {} as never,
        storageCleanupService: {} as never,
        storageAnalyzer: {} as never,
        profileWorkspaceService: {} as never,
        proxyManager: {
          stop: async () => undefined,
          ensureProfileProxy,
        } as unknown as IProxyManager,
      },
      {
        postMessage: async () => undefined,
        refresh: async () => undefined,
        refreshInstances: async () => undefined,
        refreshGithubSummaries: async () => undefined,
        refreshProxyStatus: async () => undefined,
        hasActiveWebview: () => true,
      }
    );

    await handlers.handle({
      type: 'edit',
      profileId: 'p1',
      updates: { proxyEnabled: true },
    });

    assert.equal(ensureProfileProxy.mock.callCount(), 1);
    assert.deepEqual(ensureProfileProxy.mock.calls[0]?.arguments, ['p1']);
  });

  it('restarts only the edited profile proxy when JSONL logging is toggled', async () => {
    const restartProfileProxy = mock.fn(async () => ({ success: true, port: 8080 }));
    const isRunning = mock.fn(async () => true);

    const handlers = new AccountsPanelHandlers(
      {
        profileManager: {
          getProfile: async () => ({
            ...CURRENT_PROFILE,
            proxyJsonlLoggingEnabled: false,
          }),
          updateProfile: async () => ({
            ...CURRENT_PROFILE,
            proxyJsonlLoggingEnabled: true,
          }),
        } as unknown as ProfileManager,
        profileLauncher: {} as never,
        profileDetector: {
          detectCurrentProfile: async () => CURRENT_PROFILE,
        } as ProfileDetector,
        efficiencyService: {} as never,
        authReader: {} as never,
        instanceDetector: {} as never,
        storageCleanupService: {} as never,
        storageAnalyzer: {} as never,
        profileWorkspaceService: {} as never,
        proxyManager: {
          isRunning,
          restartProfileProxy,
        } as unknown as IProxyManager,
      },
      {
        postMessage: async () => undefined,
        refresh: async () => undefined,
        refreshInstances: async () => undefined,
        refreshGithubSummaries: async () => undefined,
        refreshProxyStatus: async () => undefined,
        hasActiveWebview: () => true,
      }
    );

    await handlers.handle({
      type: 'edit',
      profileId: 'p1',
      updates: { proxyJsonlLoggingEnabled: true },
    });

    assert.equal(isRunning.mock.callCount(), 1);
    assert.equal(restartProfileProxy.mock.callCount(), 1);
    assert.deepEqual(restartProfileProxy.mock.calls[0]?.arguments, ['p1']);
  });

  it('does not restart proxy when JSONL logging value is unchanged', async () => {
    const restartProfileProxy = mock.fn(async () => ({ success: true, port: 8080 }));

    const handlers = new AccountsPanelHandlers(
      {
        profileManager: {
          getProfile: async () => ({
            ...CURRENT_PROFILE,
            proxyJsonlLoggingEnabled: true,
          }),
          updateProfile: async () => ({
            ...CURRENT_PROFILE,
            proxyJsonlLoggingEnabled: true,
          }),
        } as unknown as ProfileManager,
        profileLauncher: {} as never,
        profileDetector: {
          detectCurrentProfile: async () => CURRENT_PROFILE,
        } as ProfileDetector,
        efficiencyService: {} as never,
        authReader: {} as never,
        instanceDetector: {} as never,
        storageCleanupService: {} as never,
        storageAnalyzer: {} as never,
        profileWorkspaceService: {} as never,
        proxyManager: {
          isRunning: async () => true,
          restartProfileProxy,
        } as unknown as IProxyManager,
      },
      {
        postMessage: async () => undefined,
        refresh: async () => undefined,
        refreshInstances: async () => undefined,
        refreshGithubSummaries: async () => undefined,
        refreshProxyStatus: async () => undefined,
        hasActiveWebview: () => true,
      }
    );

    await handlers.handle({
      type: 'edit',
      profileId: 'p1',
      updates: { proxyJsonlLoggingEnabled: true, displayName: 'User' },
    });

    assert.equal(restartProfileProxy.mock.callCount(), 0);
  });
});
