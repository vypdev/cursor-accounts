import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IProfileReader } from '../../domain/ports/IProfileReader';
import type { IProxyStateStore } from '../../domain/ports/IProxyStateStore';
import type { IProxyTrafficIngress } from '../../domain/ports/IProxyTrafficIngress';
import type { Profile } from '@cursor-accounts/types';
import { ProxyTrafficBus } from '../../proxy/proxyTrafficBus';
import {
  createProxyManagerComposition,
  type ProxyManagerRuntime,
} from '../../services/proxyManagerComposition';
import type { ProxyManagerDependencies } from '../../services/proxyManagerDefaultDependencies';
import { SHARED_PROXY_RUNTIME_KEY } from '../../proxy/types';

describe('ProxyManager composition', () => {
  it('keeps profile runtime tokens ahead of shared and persisted fallbacks', async () => {
    const profile: Profile = {
      id: 'profile-a',
      displayName: 'Profile A',
      userDataDir: '/tmp/profile-a',
      proxyEnabled: true,
    } as Profile;
    const profileManager: IProfileReader = {
      getProfile: async () => profile,
      getProfiles: async () => [profile],
      findProfileByEmail: async () => undefined,
      findProfileByPath: async () => undefined,
    };
    const stateStore: IProxyStateStore = {
      read: async () => ({
        version: 1,
        profileId: profile.id,
        running: true,
        port: 8080,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        apiToken: 'profile-state-token',
      }),
      write: async () => undefined,
      clear: async () => undefined,
    };
    const trafficIngress: IProxyTrafficIngress = {
      start: async () => undefined,
      stop: () => undefined,
      stopAll: () => undefined,
      isRunning: () => false,
      getActivePort: () => null,
    };
    const sharedStateStore = {
      read: async () => ({
        version: 1,
        profileId: SHARED_PROXY_RUNTIME_KEY,
        running: true,
        port: 8080,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        apiToken: 'persisted-shared-token',
      }),
      write: async () => undefined,
      clear: async () => undefined,
    };
    const runtimes = new Map<string, ProxyManagerRuntime>();
    const dependencies: ProxyManagerDependencies = {
      certService: {} as never,
      trafficBus: new ProxyTrafficBus(),
      trafficIngress,
      sharedStateStore,
      createProcess: () => ({}) as never,
    };
    const composition = createProxyManagerComposition({
      stateStore,
      profileManager,
      context: {
        extensionPath: '/tmp/extension',
      } as never,
      storageDir: '/tmp/cursor-accounts-composition',
      dependencies,
      getOutputConfig: () => ({
        logTrafficToOutput: false,
        autoShowOutputChannel: false,
        outputCursorHostsOnly: false,
      }),
      callbacks: {
        notifyStatusChange: () => undefined,
        notifyUsagePersisted: () => undefined,
      },
      runtimes,
    });

    runtimes.set(SHARED_PROXY_RUNTIME_KEY, {
      process: {} as never,
      port: 8080,
      apiPort: 18_080,
      userDataDir: '/tmp/shared',
      apiToken: 'shared-runtime-token',
    });
    runtimes.set(profile.id, {
      process: {} as never,
      port: 8081,
      apiPort: 18_081,
      userDataDir: profile.userDataDir,
      apiToken: 'profile-runtime-token',
    });

    assert.equal(
      await composition.getApiToken(profile.id),
      'profile-runtime-token'
    );
    runtimes.delete(profile.id);
    assert.equal(
      await composition.getApiToken(profile.id),
      'shared-runtime-token'
    );
    runtimes.delete(SHARED_PROXY_RUNTIME_KEY);
    assert.equal(
      await composition.getApiToken(profile.id),
      'persisted-shared-token'
    );
  });
});
