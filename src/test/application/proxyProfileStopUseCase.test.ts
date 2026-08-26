import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile, ProxyStateFile } from '@cursor-accounts/types';
import {
  ProxyProfileStopUseCase,
  type ProxyProfileStopUseCaseDependencies,
} from '../../application/services/proxyProfileStopUseCase';

function createProfile(): Profile {
  return {
    id: 'profile-1',
    displayName: 'Profile 1',
    userDataDir: '/tmp/profile-1',
    proxyEnabled: true,
  } as Profile;
}

function createState(): ProxyStateFile {
  return {
    version: 1,
    profileId: 'profile-1',
    running: true,
    port: 8080,
    apiPort: 18_080,
    apiToken: 'a'.repeat(64),
    pid: 123,
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
  };
}

function createDependencies(
  overrides: Partial<ProxyProfileStopUseCaseDependencies> = {}
): ProxyProfileStopUseCaseDependencies & { events: string[] } {
  const events: string[] = [];
  const dependencies: ProxyProfileStopUseCaseDependencies = {
    profileManager: {
      getProfile: async () => createProfile(),
      getProfiles: async () => [],
      findProfileByEmail: async () => undefined,
      findProfileByPath: async () => undefined,
    },
    stateStore: {
      read: async () => createState(),
      write: async () => undefined,
      clear: async () => {
        events.push('clear-state');
      },
    },
    trafficIngress: {
      start: async () => undefined,
      stop: (profileId) => events.push(`stop-ingress:${profileId}`),
      stopAll: () => undefined,
      isRunning: () => false,
      getActivePort: () => null,
    },
    getRuntime: () => undefined,
    isSharedProxyActive: () => false,
    createApiClient: (apiPort, apiToken) => ({
      shutdown: async () => {
        events.push(`shutdown-api:${apiPort}:${apiToken?.length ?? 0}`);
      },
    }),
    resolveApiPort: (_mitmPort, persistedApiPort) =>
      persistedApiPort ?? 18_080,
    forceStopChild: async () => {
      events.push('stop-child');
    },
    restoreProxySettings: async () => {
      events.push('restore-settings');
    },
    wait: async (milliseconds) => {
      events.push(`wait:${milliseconds}`);
    },
    logDebug: (message) => {
      events.push(`debug:${message}`);
    },
    logError: (message) => {
      events.push(`error:${message}`);
    },
    logInfo: (message) => {
      events.push(`info:${message}`);
    },
    logWarn: (message) => {
      events.push(`warn:${message}`);
    },
    appendStopped: () => {
      events.push('append-stopped');
    },
    notifyStatusChange: () => {
      events.push('status-change');
    },
    ...overrides,
  };
  return Object.assign(dependencies, { events });
}

describe('ProxyProfileStopUseCase', () => {
  it('shuts down the API, stops the child and restores profile side effects', async () => {
    const dependencies = createDependencies();

    await new ProxyProfileStopUseCase(dependencies).execute('profile-1');

    assert.deepEqual(dependencies.events, [
      'shutdown-api:18080:64',
      'wait:500',
      'stop-child',
      'stop-ingress:profile-1',
      'restore-settings',
      'clear-state',
      'info:[Proxy:profile-1] Stopped',
      'append-stopped',
      'status-change',
    ]);
  });

  it('uses the in-memory runtime API port before persisted state', async () => {
    const dependencies = createDependencies({
      getRuntime: () => ({ apiPort: 19_080, apiToken: 'runtime-token' }),
      resolveApiPort: () => {
        throw new Error('persisted port should not be resolved');
      },
    });

    await new ProxyProfileStopUseCase(dependencies).execute('profile-1');

    assert.equal(dependencies.events[0], 'shutdown-api:19080:64');
  });

  it('falls back to child-process stop when API shutdown fails', async () => {
    const dependencies = createDependencies({
      createApiClient: () => ({
        shutdown: async () => {
          throw new Error('api unavailable');
        },
      }),
    });

    await new ProxyProfileStopUseCase(dependencies).execute('profile-1');

    assert.equal(dependencies.events[0], 'debug:[Proxy:profile-1] API shutdown failed, falling back to process stop: api unavailable');
    assert.deepEqual(dependencies.events.slice(1), [
      'stop-child',
      'stop-ingress:profile-1',
      'restore-settings',
      'clear-state',
      'info:[Proxy:profile-1] Stopped',
      'append-stopped',
      'status-change',
    ]);
  });

  it('stops local ownership without creating an API client when no port exists', async () => {
    const dependencies = createDependencies({
      stateStore: {
        read: async () => ({ ...createState(), port: undefined, apiPort: undefined }),
        write: async () => undefined,
        clear: async () => {
          dependencies.events.push('clear-state');
        },
      },
      createApiClient: () => {
        throw new Error('API client should not be created');
      },
    });

    await new ProxyProfileStopUseCase(dependencies).execute('profile-1');

    assert.deepEqual(dependencies.events, [
      'stop-child',
      'stop-ingress:profile-1',
      'restore-settings',
      'clear-state',
      'info:[Proxy:profile-1] Stopped',
      'append-stopped',
      'status-change',
    ]);
  });

  it('only restores settings when shared runtime ownership is active', async () => {
    const dependencies = createDependencies({
      isSharedProxyActive: () => true,
    });

    await new ProxyProfileStopUseCase(dependencies).execute('profile-1');

    assert.deepEqual(dependencies.events, ['restore-settings']);
  });

  it('continues cleanup when settings restoration fails', async () => {
    const dependencies = createDependencies({
      restoreProxySettings: async () => {
        throw new Error('settings unavailable');
      },
    });

    await new ProxyProfileStopUseCase(dependencies).execute('profile-1');

    assert.equal(
      dependencies.events[4],
      'warn:[Proxy:profile-1] Failed to restore profile settings: settings unavailable'
    );
    assert.deepEqual(dependencies.events.slice(5), [
      'clear-state',
      'info:[Proxy:profile-1] Stopped',
      'append-stopped',
      'status-change',
    ]);
  });

  it('does nothing for an unknown profile and can skip restoration', async () => {
    const missingProfile = createDependencies({
      profileManager: {
        getProfile: async () => undefined,
        getProfiles: async () => [],
        findProfileByEmail: async () => undefined,
        findProfileByPath: async () => undefined,
      },
    });
    await new ProxyProfileStopUseCase(missingProfile).execute('profile-1');
    assert.deepEqual(missingProfile.events, []);

    const withoutRestore = createDependencies();
    await new ProxyProfileStopUseCase(withoutRestore).execute('profile-1', {
      restoreSettings: false,
    });
    assert.equal(withoutRestore.events.includes('restore-settings'), false);
  });
});
