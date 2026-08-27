import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile, ProxyStateFile } from '@cursor-accounts/types';
import type { SharedProxyRuntimeEnsureUseCaseDependencies } from '../../application/services/sharedProxyRuntimeEnsureUseCase';
import { SharedProxyRuntimeEnsureUseCase } from '../../application/services/sharedProxyRuntimeEnsureUseCase';
import type { SharedProxyRuntime } from '../../application/services/sharedProxyRuntimeStartUseCase';

function profile(id: string, proxyEnabled = true): Profile {
  return {
    id,
    displayName: id,
    userDataDir: `/tmp/${id}`,
    proxyEnabled,
  } as Profile;
}

function persistedState(overrides: Partial<ProxyStateFile> = {}): ProxyStateFile {
  return {
    version: 1,
    profileId: 'shared',
    running: true,
    port: 8080,
    apiPort: 18_080,
    apiToken: 'token',
    pid: 123,
    startedAt: '2026-08-27T00:00:00.000Z',
    caCertificatePath: '/tmp/ca.pem',
    lastUpdatedAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

function setup(
  overrides: Partial<SharedProxyRuntimeEnsureUseCaseDependencies> = {}
) {
  let persisted: ProxyStateFile | null = null;
  let runtime: SharedProxyRuntime | undefined;
  const prepared: string[] = [];
  const ingresses: Array<{ port: number; apiPort: number; forceRestart: boolean }> = [];
  const cleared: number[] = [];
  const started: Profile[][] = [];
  let notifications = 0;
  let statusRunning = true;

  const dependencies: SharedProxyRuntimeEnsureUseCaseDependencies = {
    sharedProxyPort: 8080,
    stateStore: {
      read: async () => persisted,
      clear: async () => {
        cleared.push(1);
      },
    },
    getRuntime: () => runtime,
    resolveApiPort: (port, apiPort) => apiPort ?? port + 10_000,
    createApiClient: () => ({
      getStatus: async () => ({ running: statusRunning }),
    }),
    isPortAvailable: async () => true,
    prepareProfile: async (selected) => {
      prepared.push(selected.id);
    },
    ensureTrafficIngress: async (port, apiPort, options) => {
      ingresses.push({ port, apiPort, forceRestart: options.forceRestart });
    },
    startRuntime: async (profiles) => {
      started.push(profiles);
      return { success: true, port: 8080 };
    },
    notifyStatusChange: () => {
      notifications += 1;
    },
    ...overrides,
  };

  return {
    dependencies,
    setPersisted: (state: ProxyStateFile | null) => {
      persisted = state;
    },
    setRuntime: (value: SharedProxyRuntime) => {
      runtime = value;
    },
    setStatusRunning: (value: boolean) => {
      statusRunning = value;
    },
    state: () => ({ prepared, ingresses, cleared, started, notifications }),
  };
}

describe('SharedProxyRuntimeEnsureUseCase', () => {
  it('rejects requests without enabled profiles', async () => {
    const setupState = setup();
    const useCase = new SharedProxyRuntimeEnsureUseCase(setupState.dependencies);

    const result = await useCase.execute([profile('disabled', false)]);

    assert.deepEqual(result, {
      success: false,
      error: 'No profiles with proxy enabled',
    });
    assert.deepEqual(setupState.state().started, []);
  });

  it('reuses an in-memory runtime and configures each enabled profile', async () => {
    const setupState = setup();
    setupState.setRuntime({
      process: {} as never,
      port: 8090,
      apiPort: 18_090,
      userDataDir: '/tmp/shared',
      apiToken: 'runtime-token',
    });
    const useCase = new SharedProxyRuntimeEnsureUseCase(setupState.dependencies);

    const result = await useCase.execute([
      profile('profile-1'),
      profile('disabled', false),
      profile('profile-2'),
    ]);

    assert.deepEqual(result, { success: true, port: 8090 });
    assert.deepEqual(setupState.state().prepared, ['profile-1', 'profile-2']);
    assert.deepEqual(
      setupState.state().ingresses.map(({ forceRestart }) => forceRestart),
      [false, false]
    );
  });

  it('attaches to a healthy persisted runtime', async () => {
    const setupState = setup();
    setupState.setPersisted(persistedState());
    const useCase = new SharedProxyRuntimeEnsureUseCase(setupState.dependencies);

    const result = await useCase.execute([profile('profile-1')]);

    assert.deepEqual(result, { success: true, port: 8080 });
    assert.deepEqual(setupState.state().prepared, ['profile-1']);
    assert.deepEqual(setupState.state().ingresses, [
      { port: 8080, apiPort: 18_080, forceRestart: true },
    ]);
    assert.equal(setupState.state().notifications, 1);
  });

  it('falls back to a fresh start when the persisted runtime is not running', async () => {
    const setupState = setup();
    setupState.setPersisted(persistedState());
    setupState.setStatusRunning(false);
    const useCase = new SharedProxyRuntimeEnsureUseCase({
      ...setupState.dependencies,
      isPortAvailable: async () => true,
    });

    const result = await useCase.execute([profile('profile-1')]);

    assert.deepEqual(result, { success: true, port: 8080 });
    assert.deepEqual(setupState.state().started, [[profile('profile-1')]]);
    assert.deepEqual(setupState.state().cleared, []);
  });

  it('clears an unreadable persisted runtime before starting', async () => {
    const setupState = setup();
    setupState.setPersisted(persistedState());
    const useCase = new SharedProxyRuntimeEnsureUseCase({
      ...setupState.dependencies,
      createApiClient: () => ({
        getStatus: async () => {
          throw new Error('API unavailable');
        },
      }),
    });

    const result = await useCase.execute([profile('profile-1')]);

    assert.deepEqual(result, { success: true, port: 8080 });
    assert.equal(setupState.state().cleared.length, 1);
    assert.equal(setupState.state().started.length, 1);
  });

  it('reports an unavailable shared port without starting a runtime', async () => {
    const setupState = setup({ isPortAvailable: async () => false });
    const useCase = new SharedProxyRuntimeEnsureUseCase(setupState.dependencies);

    const result = await useCase.execute([profile('profile-1')]);

    assert.deepEqual(result, {
      success: false,
      error: 'Shared proxy port 8080 is not available',
    });
    assert.deepEqual(setupState.state().started, []);
  });
});
