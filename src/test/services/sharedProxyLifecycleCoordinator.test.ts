import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile, ProxyStateFile } from '@cursor-accounts/types';
import type { IProxyProcess } from '../../domain/ports/IProxyProcess';
import type { SharedProxyLifecycleCoordinatorDependencies } from '../../services/sharedProxyLifecycleCoordinator';
import { SharedProxyLifecycleCoordinator } from '../../services/sharedProxyLifecycleCoordinator';
import { DEFAULT_PROXY_PORT } from '../../proxy/types';

function profile(id = 'profile-1'): Profile {
  return {
    id,
    displayName: id,
    userDataDir: `/tmp/${id}`,
    proxyEnabled: true,
  } as Profile;
}

function dependencies(overrides: Record<string, unknown> = {}) {
  let runtime: unknown;
  let exitHandler: ((code: number | null) => void) | undefined;
  let stderrHandler: ((line: string) => void) | undefined;
  let processStopped = false;
  const writes: ProxyStateFile[] = [];
  const cleared: boolean[] = [];
  const prepared: string[] = [];
  const ingresses: Array<{ port: number; apiPort: number; forceRestart: boolean }> = [];
  let notifications = 0;
  let trafficStops = 0;
  let started: number | undefined;
  let outputShown = 0;

  const process: IProxyProcess = {
    start: async () => ({
      port: DEFAULT_PROXY_PORT,
      apiPort: DEFAULT_PROXY_PORT + 10_000,
      pid: 123,
      startedAt: new Date(),
    }),
    stop: async () => {
      processStopped = true;
    },
    isAlive: () => true,
    onExit: (handler) => {
      exitHandler = handler;
    },
    onStderr: (handler) => {
      stderrHandler = handler;
    },
  };

  const base = {
    storageDir: '/tmp/proxy-storage',
    logDir: '/tmp/proxy-storage/logs',
    stateStore: {
      read: async () => null,
      write: async (value: ProxyStateFile) => {
        writes.push(value);
      },
      clear: async () => {
        cleared.push(true);
      },
    },
    certService: { ensureCaCertificate: async () => '/tmp/ca.pem' },
    createProcess: () => process,
    isPortAvailable: async () => true,
    createApiClient: () => ({
      getStatus: async () => ({ running: true }),
      shutdown: async () => undefined,
    }),
    resolveApiPort: (port: number, persisted?: number) => persisted ?? port + 10_000,
    buildServerConfig: (port: number, selected: Profile, overrides: Record<string, unknown>) => ({
      port,
      apiPort: port + 10_000,
      apiToken: 'b'.repeat(64),
      profileId: selected.id,
      storageDir: '/tmp/proxy-storage',
      logDir: '/tmp/proxy-storage/logs',
      maxLogSizeMb: 1,
      maxBodyLogBytes: 1,
      spillLargeBodies: true,
      developmentMode: false,
      trafficDiagnostics: true,
      diagnosticsIntervalMs: 30_000,
      ...overrides,
    }),
    buildUserIdMapping: async () => new Map<string, string>(),
    buildProfileDbPaths: () => ({}),
    prepareProfile: async (selected: Profile) => {
      prepared.push(selected.id);
    },
    ensureTrafficIngress: async (port: number, apiPort: number, options: { forceRestart: boolean }) => {
      ingresses.push({ port, apiPort, forceRestart: options.forceRestart });
    },
    stopTrafficIngress: () => {
      trafficStops += 1;
    },
    getRuntime: () => runtime,
    setRuntime: (value: unknown) => {
      runtime = value;
    },
    deleteRuntime: () => {
      runtime = undefined;
    },
    stopRuntime: async () => {
      processStopped = true;
      runtime = undefined;
    },
    appendStarted: (port: number) => {
      started = port;
    },
    showOutput: () => {
      outputShown += 1;
    },
    shouldAutoShowOutput: () => true,
    notifyStatusChange: () => {
      notifications += 1;
    },
    ...overrides,
  };

  return {
    dependencies: base as unknown as SharedProxyLifecycleCoordinatorDependencies,
    process,
    getState: () => ({
      runtime,
      exitHandler,
      stderrHandler,
      processStopped,
      writes,
      cleared,
      prepared,
      ingresses,
      notifications,
      trafficStops,
      started,
      outputShown,
    }),
  };
}

describe('SharedProxyLifecycleCoordinator', () => {
  it('attaches an existing runtime and configures all enabled profiles', async () => {
    const setup = dependencies();
    const existing = {
      process: setup.process,
      port: 8080,
      apiPort: 18_080,
      userDataDir: '/tmp/proxy-storage',
      apiToken: 'c'.repeat(64),
    };
    setup.dependencies.getRuntime = () => existing;
    const coordinator = new SharedProxyLifecycleCoordinator(setup.dependencies);

    const result = await coordinator.ensure([profile(), profile('profile-2')]);

    assert.deepEqual(result, { success: true, port: 8080 });
    assert.deepEqual(setup.getState().prepared, ['profile-1', 'profile-2']);
    assert.equal(setup.getState().ingresses.length, 2);
    assert.equal(setup.getState().ingresses[0]?.forceRestart, false);
  });

  it('starts a new runtime, persists ownership, and handles child exit', async () => {
    const setup = dependencies();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;

    try {
      const coordinator = new SharedProxyLifecycleCoordinator(setup.dependencies);
      const result = await coordinator.ensure([profile()]);

      assert.deepEqual(result, { success: true, port: DEFAULT_PROXY_PORT });
      assert.equal(setup.getState().started, DEFAULT_PROXY_PORT);
      assert.equal(setup.getState().writes.length, 1);
      assert.deepEqual(setup.getState().prepared, ['profile-1']);
      assert.equal(setup.getState().ingresses[0]?.forceRestart, true);
      assert.equal(setup.getState().outputShown, 1);

      setup.getState().exitHandler?.(0);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(setup.getState().runtime, undefined);
      assert.equal(setup.getState().trafficStops, 1);
      assert.equal(setup.getState().notifications, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('stops the API, child runtime, ingress, and state in order', async () => {
    const setup = dependencies();
    setup.dependencies.getRuntime = () => ({
      process: setup.process,
      port: 8080,
      apiPort: 18_080,
      userDataDir: '/tmp/proxy-storage',
      apiToken: 'd'.repeat(64),
    });
    const coordinator = new SharedProxyLifecycleCoordinator(setup.dependencies);

    await coordinator.stop();

    assert.equal(setup.getState().processStopped, true);
    assert.equal(setup.getState().trafficStops, 1);
    assert.equal(setup.getState().cleared.length, 1);
    assert.equal(setup.getState().notifications, 1);
  });
});
