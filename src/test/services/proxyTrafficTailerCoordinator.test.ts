import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IProfileManager } from '../../domain/ports/IProfileManager';
import type { ProxyStateFile, ProxyStatus } from '@cursor-accounts/types';
import type { SharedProxyRuntime } from '../../services/sharedProxyLifecycleCoordinator';
import {
  ProxyTrafficTailerCoordinator,
  type ProxyTrafficTailerCoordinatorDependencies,
} from '../../services/proxyTrafficTailerCoordinator';
import { SHARED_PROXY_RUNTIME_KEY } from '../../proxy/types';

const profile = {
  id: 'profile-1',
  displayName: 'Profile 1',
  userDataDir: '/tmp/profile-1',
  proxyEnabled: true,
};

const runtime: SharedProxyRuntime = {
  process: {} as never,
  port: 8080,
  apiPort: 18_080,
  userDataDir: '/tmp/proxy',
  apiToken: 'runtime-token',
};

function setup(overrides: Partial<ProxyTrafficTailerCoordinatorDependencies> = {}) {
  const calls: Array<{
    profileId: string;
    port: number;
    apiPort: number;
    options: unknown;
  }> = [];
  const dependencies: ProxyTrafficTailerCoordinatorDependencies = {
    profileManager: {
      getProfiles: async () => [profile],
      getProfile: async () => profile,
    } as unknown as IProfileManager,
    getRuntime: () => undefined,
    runtimes: () => new Map<string, SharedProxyRuntime>(),
    readSharedState: async () => null,
    getStatus: async () => null,
    isRunning: async () => false,
    resolveApiPort: (port, persisted) => persisted ?? port + 10_000,
    getApiToken: async () => 'profile-token',
    ensureTrafficIngress: async (profileId, port, apiPort, options) => {
      calls.push({ profileId, port, apiPort, options });
    },
    ...overrides,
  };
  return {
    calls,
    coordinator: new ProxyTrafficTailerCoordinator(dependencies),
  };
}

describe('ProxyTrafficTailerCoordinator', () => {
  it('does nothing when output status is not running', async () => {
    const { coordinator, calls } = setup();

    await coordinator.ensureOutputTailer('profile-1');

    assert.deepEqual(calls, []);
  });

  it('attaches an output tailer using the status endpoint and token', async () => {
    const status: ProxyStatus = { running: true, port: 8081, apiPort: 18_081 };
    const { coordinator, calls } = setup({
      getStatus: async () => status,
      getApiToken: async () => 'status-token',
    });

    await coordinator.ensureOutputTailer('profile-1', {
      tailFromStart: true,
      forceRestart: true,
    });

    assert.deepEqual(calls, [
      {
        profileId: 'profile-1',
        port: 8081,
        apiPort: 18_081,
        options: {
          forceRestart: true,
          tailFromStart: true,
          apiToken: 'status-token',
        },
      },
    ]);
  });

  it('prefers a live shared runtime', async () => {
    const { coordinator, calls } = setup({
      getRuntime: (id) => (id === SHARED_PROXY_RUNTIME_KEY ? runtime : undefined),
    });

    await coordinator.ensureTrafficTailer();

    assert.deepEqual(calls[0], {
      profileId: SHARED_PROXY_RUNTIME_KEY,
      port: 8080,
      apiPort: 18_080,
      options: { forceRestart: false, apiToken: 'runtime-token' },
    });
  });

  it('attaches to persisted shared state when no runtime exists', async () => {
    const sharedState: ProxyStateFile = {
      version: 1,
      profileId: SHARED_PROXY_RUNTIME_KEY,
      running: true,
      port: 8082,
      apiPort: 18_082,
      apiToken: 'shared-token',
      lastUpdatedAt: new Date().toISOString(),
    };
    const { coordinator, calls } = setup({
      readSharedState: async () => sharedState,
    });

    await coordinator.ensureTrafficTailer();

    assert.deepEqual(calls[0], {
      profileId: SHARED_PROXY_RUNTIME_KEY,
      port: 8082,
      apiPort: 18_082,
      options: { forceRestart: false, apiToken: 'shared-token' },
    });
  });

  it('uses the first non-shared in-memory runtime as a fallback', async () => {
    const { coordinator, calls } = setup({
      runtimes: () => new Map([['profile-runtime', runtime]]),
    });

    await coordinator.ensureTrafficTailer();

    assert.deepEqual(calls[0], {
      profileId: 'profile-runtime',
      port: 8080,
      apiPort: 18_080,
      options: { forceRestart: false, apiToken: 'runtime-token' },
    });
  });

  it('falls back to the first live profile status', async () => {
    const { coordinator, calls } = setup({
      isRunning: async () => true,
      getStatus: async () => ({ running: true, port: 8083 }),
    });

    await coordinator.ensureTrafficTailer();

    assert.deepEqual(calls[0], {
      profileId: 'profile-1',
      port: 8083,
      apiPort: 18_083,
      options: { forceRestart: false, apiToken: 'profile-token' },
    });
  });
});
