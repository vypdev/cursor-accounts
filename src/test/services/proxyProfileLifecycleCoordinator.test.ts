import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile, ProxyStateFile } from '@cursor-accounts/types';
import type { ProxyProfileLifecycleCoordinatorDependencies } from '../../services/proxyProfileLifecycleCoordinator';
import { ProxyProfileLifecycleCoordinator } from '../../services/proxyProfileLifecycleCoordinator';
import { SHARED_PROXY_RUNTIME_KEY } from '../../proxy/types';

function profile(): Profile {
  return {
    id: 'profile-1',
    displayName: 'Profile 1',
    userDataDir: '/tmp/profile-1',
    proxyEnabled: true,
  } as Profile;
}

function state(profileId = 'profile-1'): ProxyStateFile {
  return {
    version: 1,
    profileId,
    running: true,
    port: 8080,
    apiPort: 18_080,
    apiToken: 'a'.repeat(64),
    pid: 123,
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
  };
}

function dependencies(
  overrides: Record<string, unknown> = {}
): ProxyProfileLifecycleCoordinatorDependencies & {
  events: string[];
} {
  const events: string[] = [];
  const base = {
    profileManager: {
      getProfile: async () => profile(),
    },
    stateStore: {
      read: async () => state(),
      clear: async () => events.push('clear-profile-state'),
      write: async () => undefined,
    },
    sharedStateStore: {
      read: async () => null,
      clear: async () => events.push('clear-shared-state'),
      write: async () => undefined,
    },
    trafficIngress: {
      start: async () => undefined,
      stop: (profileId: string) => events.push(`stop-ingress:${profileId}`),
      stopAll: () => undefined,
      isRunning: () => false,
      getActivePort: () => null,
    },
    getRuntime: () => undefined,
    isSharedProxyActive: () => false,
    createApiClient: () => ({
      getStatus: async () => ({ running: true }),
      shutdown: async () => events.push('shutdown-api'),
    }),
    resolveApiPort: (_port: number, persisted?: number) => persisted ?? 18_080,
    ensureAgentTracking: async () => events.push('tracking'),
    applyProxySettings: async () => events.push('apply-settings'),
    ensureTrafficIngress: async (profileId: string) =>
      events.push(`ensure-ingress:${profileId}`),
    forceStopChild: async () => events.push('stop-child'),
    restoreProxySettings: async () => events.push('restore-settings'),
    appendStopped: () => events.push('append-stopped'),
    notifyStatusChange: () => events.push('status-change'),
    ...overrides,
  };
  return Object.assign(base, { events }) as unknown as ProxyProfileLifecycleCoordinatorDependencies & {
    events: string[];
  };
}

describe('ProxyProfileLifecycleCoordinator', () => {
  it('attaches to a live shared proxy and starts shared ingress', async () => {
    const deps = dependencies({
      sharedStateStore: {
        read: async () => state('__shared__'),
        clear: async () => undefined,
        write: async () => undefined,
      },
    });
    const coordinator = new ProxyProfileLifecycleCoordinator(deps);

    await coordinator.connectToExistingProxy('profile-1');

    assert.deepEqual(deps.events, [
      'tracking',
      'apply-settings',
      `ensure-ingress:${SHARED_PROXY_RUNTIME_KEY}`,
      'status-change',
    ]);
  });

  it('clears a profile state when its persisted API is not running', async () => {
    const deps = dependencies({
      createApiClient: () => ({
        getStatus: async () => ({ running: false }),
        shutdown: async () => undefined,
      }),
    });
    const coordinator = new ProxyProfileLifecycleCoordinator(deps);

    await coordinator.connectToExistingProxy('profile-1');

    assert.deepEqual(deps.events, ['clear-profile-state']);
  });

  it('stops a profile runtime and restores its settings', async () => {
    const deps = dependencies();
    const coordinator = new ProxyProfileLifecycleCoordinator(deps);

    await coordinator.stop('profile-1');

    assert.deepEqual(deps.events, [
      'shutdown-api',
      'stop-child',
      'stop-ingress:profile-1',
      'restore-settings',
      'clear-profile-state',
      'append-stopped',
      'status-change',
    ]);
  });
});
