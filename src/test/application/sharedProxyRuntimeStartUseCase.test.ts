import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile, ProxyStateFile } from '@cursor-accounts/types';
import type { IProxyProcess, ProxyProcessRuntime } from '../../domain/ports/IProxyProcess';
import type { ProxyServerConfig } from '../../application/types/proxyConfig';
import {
  SharedProxyRuntimeStartUseCase,
  type SharedProxyRuntimeStartUseCaseDependencies,
} from '../../application/services/sharedProxyRuntimeStartUseCase';

function profile(id = 'profile-1'): Profile {
  return {
    id,
    email: `${id}@example.com`,
    slug: id,
    displayName: id,
    userDataDir: `/tmp/${id}`,
    created: '2026-01-01T00:00:00.000Z',
    proxyEnabled: true,
  };
}

function serverConfig(
  port: number,
  selected: Profile,
  overrides: Partial<ProxyServerConfig>
): ProxyServerConfig {
  return {
    port,
    apiPort: port + 10_000,
    apiToken: 'api-token',
    profileId: selected.id,
    storageDir: '/tmp/storage',
    logDir: '/tmp/storage/logs',
    maxLogSizeMb: 1,
    maxBodyLogBytes: 1,
    spillLargeBodies: true,
    developmentMode: false,
    trafficDiagnostics: true,
    diagnosticsIntervalMs: 30_000,
    ...overrides,
  };
}

function createUseCase(overrides: Partial<SharedProxyRuntimeStartUseCaseDependencies> = {}) {
  const runtime: ProxyProcessRuntime = {
    port: 8080,
    apiPort: 18_080,
    pid: 123,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  let stderrHandler: ((line: string) => void) | undefined;
  let exitHandler: ((code: number | null) => void) | undefined;
  let startedConfig: ProxyServerConfig | undefined;
  let stopped = false;
  const states: ProxyStateFile[] = [];
  const prepared: string[] = [];
  const ingress: Array<{ port: number; apiPort: number }> = [];
  const stderr: string[] = [];
  const exits: Array<number | null> = [];
  let storedRuntime: unknown;
  let shown = 0;
  let notifications = 0;

  const process: IProxyProcess = {
    start: async (config) => {
      startedConfig = config;
      return runtime;
    },
    stop: async () => {
      stopped = true;
    },
    isAlive: () => true,
    onExit: (handler) => {
      exitHandler = handler;
    },
    onStderr: (handler) => {
      stderrHandler = handler;
    },
  };
  const base: SharedProxyRuntimeStartUseCaseDependencies = {
    runtimeKey: 'shared',
    stateSchemaVersion: 1,
    port: 8080,
    userDataDir: '/tmp/storage',
    stateStore: {
      write: async (state) => {
        states.push(state);
      },
    },
    ensureStorageDirectories: async () => undefined,
    ensureCaCertificate: async () => '/tmp/ca.pem',
    createProcess: () => process,
    buildServerConfig: serverConfig,
    buildUserIdMapping: async () => new Map([['user-1', 'profile-1']]),
    buildProfileDbPaths: () => ({ 'profile-1': '/tmp/profile-1/efficiency.db' }),
    waitForReady: async () => ({ success: true }),
    stopFailedProcess: async () => {
      stopped = true;
    },
    setRuntime: (value) => {
      storedRuntime = value;
    },
    prepareProfile: async (selected) => {
      prepared.push(selected.id);
    },
    ensureTrafficIngress: async (port, apiPort) => {
      ingress.push({ port, apiPort });
    },
    shouldAutoShowOutput: () => true,
    showOutput: () => {
      shown += 1;
    },
    appendStarted: () => undefined,
    notifyStatusChange: () => {
      notifications += 1;
    },
    onStderrLine: (line) => {
      stderr.push(line);
    },
    onProcessExit: (code) => {
      exits.push(code);
    },
    now: () => '2026-01-01T00:00:01.000Z',
    logStarted: () => undefined,
    ...overrides,
  };

  return {
    useCase: new SharedProxyRuntimeStartUseCase(base),
    process,
    runtime,
    getState: () => ({
      stderrHandler,
      exitHandler,
      startedConfig,
      stopped,
      states,
      prepared,
      ingress,
      stderr,
      exits,
      storedRuntime,
      shown,
      notifications,
    }),
  };
}

describe('SharedProxyRuntimeStartUseCase', () => {
  it('starts the process, persists ownership, and prepares all profiles', async () => {
    const setup = createUseCase();

    const result = await setup.useCase.execute([profile('profile-1'), profile('profile-2')]);
    const state = setup.getState();

    assert.deepEqual(result, { success: true, port: 8080 });
    assert.equal(state.startedConfig?.profileId, 'shared');
    assert.deepEqual(state.startedConfig?.userIdToProfileId, {
      'user-1': 'profile-1',
    });
    assert.equal(state.states[0]?.apiToken, 'api-token');
    assert.deepEqual(state.prepared, ['profile-1', 'profile-2']);
    assert.deepEqual(state.ingress[0], { port: 8080, apiPort: 18_080 });
    assert.ok(state.storedRuntime);
    assert.equal(state.shown, 1);
    assert.equal(state.notifications, 1);
  });

  it('stops a failed process and returns the readiness error', async () => {
    const setup = createUseCase({
      waitForReady: async () => ({
        success: false,
        error: 'proxy did not become ready',
      }),
    });

    const result = await setup.useCase.execute([profile()]);

    assert.deepEqual(result, {
      success: false,
      error: 'proxy did not become ready',
    });
    assert.equal(setup.getState().stopped, true);
    assert.equal(setup.getState().states.length, 0);
  });

  it('forwards process stderr and exit events to lifecycle callbacks', async () => {
    const setup = createUseCase();
    await setup.useCase.execute([profile()]);

    setup.getState().stderrHandler?.('child diagnostic');
    setup.getState().exitHandler?.(17);

    assert.deepEqual(setup.getState().stderr, ['child diagnostic']);
    assert.deepEqual(setup.getState().exits, [17]);
  });

  it('uses the injected clock and schema identity for persisted ownership', async () => {
    const setup = createUseCase({
      runtimeKey: 'shared-runtime',
      stateSchemaVersion: 7,
      now: () => '2026-02-03T04:05:06.000Z',
    });

    await setup.useCase.execute([profile()]);

    assert.deepEqual(setup.getState().states[0], {
      version: 7,
      profileId: 'shared-runtime',
      running: true,
      port: 8080,
      apiPort: 18_080,
      apiToken: 'api-token',
      pid: 123,
      startedAt: '2026-02-03T04:05:06.000Z',
      caCertificatePath: '/tmp/ca.pem',
      lastUpdatedAt: '2026-02-03T04:05:06.000Z',
    });
  });
});
