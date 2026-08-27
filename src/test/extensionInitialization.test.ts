import './registerVscodeMock';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile } from '@cursor-accounts/types';
import {
  initializeExtensionRuntime,
} from '../composition/extensionInitialization';
import type { ExtensionRuntime } from '../composition/createExtensionRuntime';

function createProfile(id: string, proxyEnabled = true): Profile {
  return {
    id,
    email: `${id}@example.com`,
    slug: id,
    displayName: id,
    userDataDir: `/tmp/${id}`,
    created: '2026-01-01T00:00:00.000Z',
    proxyEnabled,
  };
}

function createRuntime(
  profiles: Profile[],
  currentProfile: Profile | null
): { runtime: ExtensionRuntime; calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const record = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };

  const runtime = {
    profileManager: {
      initialize: async () => record('profileManager.initialize'),
      getProfiles: async () => {
        record('profileManager.getProfiles');
        return profiles;
      },
    },
    profileDetector: {
      detectCurrentProfile: async () => {
        record('profileDetector.detectCurrentProfile');
        return currentProfile;
      },
    },
    proxyManager: {
      ensureSharedProxy: async () => {
        record('proxyManager.ensureSharedProxy');
        return { success: true, port: 8080 };
      },
      ensureTrafficTailer: async () => record('proxyManager.ensureTrafficTailer'),
      connectToExistingProxy: async () => record('proxyManager.connectToExistingProxy'),
      dispose: () => record('proxyManager.dispose'),
    },
    efficiencyService: {
      initialize: async () => record('efficiencyService.initialize'),
    },
    accountsPanel: {
      refreshProxyStatus: async () => record('accountsPanel.refreshProxyStatus'),
      openPanel: () => record('accountsPanel.openPanel'),
      hasResolvedView: () => true,
    },
  } as unknown as ExtensionRuntime;

  return { runtime, calls };
}

describe('initializeExtensionRuntime', () => {
  it('opens the panel for an unassigned window without connecting a profile', async () => {
    const { runtime, calls } = createRuntime([], null);

    await initializeExtensionRuntime(runtime, () => true);

    assert.equal(calls['profileManager.initialize'], 1);
    assert.equal(calls['profileManager.getProfiles'], 1);
    assert.equal(calls['efficiencyService.initialize'], 1);
    assert.equal(calls['profileDetector.detectCurrentProfile'], 1);
    assert.equal(calls['accountsPanel.openPanel'], 1);
    assert.equal(calls['proxyManager.connectToExistingProxy'] ?? 0, 0);
  });

  it('starts shared proxy services and connects the active profile', async () => {
    const profile = createProfile('profile-1');
    const { runtime, calls } = createRuntime([profile], profile);

    await initializeExtensionRuntime(runtime, () => true);

    assert.equal(calls['proxyManager.ensureSharedProxy'], 1);
    assert.equal(calls['proxyManager.ensureTrafficTailer'], 1);
    assert.equal(calls['accountsPanel.refreshProxyStatus'], 1);
    assert.equal(calls['proxyManager.connectToExistingProxy'], 1);
    assert.equal(calls['accountsPanel.openPanel'], 1);
  });

  it('disposes the shared proxy when activation becomes stale after startup', async () => {
    const profile = createProfile('profile-1');
    const { runtime, calls } = createRuntime([profile], profile);
    let guardCalls = 0;

    await initializeExtensionRuntime(runtime, () => {
      guardCalls += 1;
      return guardCalls < 5;
    });

    assert.equal(calls['proxyManager.ensureSharedProxy'], 1);
    assert.equal(calls['proxyManager.dispose'], 1);
    assert.equal(calls['profileDetector.detectCurrentProfile'] ?? 0, 0);
    assert.equal(calls['accountsPanel.openPanel'] ?? 0, 0);
  });
});
