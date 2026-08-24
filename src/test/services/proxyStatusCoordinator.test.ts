import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile, ProxyStateFile } from '@cursor-accounts/types';
import type { IProfileManager } from '../../domain/ports/IProfileManager';
import type { IProxyStateStore } from '../../domain/ports/IProxyStateStore';
import type { SharedProxyRuntime } from '../../services/sharedProxyLifecycleCoordinator';
import {
  ProxyStatusCoordinator,
  type ProxyStatusCoordinatorDependencies,
} from '../../services/proxyStatusCoordinator';
import { SHARED_PROXY_RUNTIME_KEY } from '../../proxy/types';

const profile: Profile = {
  id: 'profile-1',
  displayName: 'Profile 1',
  userDataDir: '/tmp/profile-1',
  proxyEnabled: true,
} as Profile;

function state(overrides: Partial<ProxyStateFile> = {}): ProxyStateFile {
  return {
    version: 1,
    profileId: profile.id,
    running: true,
    port: 8080,
    apiPort: 18_080,
    pid: 123,
    startedAt: '2026-01-01T00:00:00.000Z',
    caCertificatePath: '/tmp/ca.crt',
    lastUpdatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function runtime(port = 8080, apiPort = 18_080): SharedProxyRuntime {
  return {
    process: {} as never,
    port,
    apiPort,
    userDataDir: '/tmp/proxy',
  };
}

function setup(overrides: Partial<{
  profile: Profile | undefined;
  state: ProxyStateFile | null;
  sharedState: ProxyStateFile | null;
  profileRuntime: SharedProxyRuntime | undefined;
  sharedRuntime: SharedProxyRuntime | undefined;
  alive: boolean;
  portAvailable: boolean;
}> = {}): {
  coordinator: ProxyStatusCoordinator;
  cleared: string[];
} {
  const options = {
    profile,
    state: null,
    sharedState: null,
    profileRuntime: undefined,
    sharedRuntime: undefined,
    alive: true,
    portAvailable: false,
    ...overrides,
  };
  const cleared: string[] = [];
  const stateStore: IProxyStateStore = {
    read: async () => options.state,
    write: async () => undefined,
    clear: async (userDataDir) => {
      cleared.push(userDataDir);
    },
  };
  const profileManager = {
    getProfile: async () => options.profile,
  } as unknown as IProfileManager;
  const runtimes = new Map<string, SharedProxyRuntime | undefined>([
    [profile.id, options.profileRuntime],
    [SHARED_PROXY_RUNTIME_KEY, options.sharedRuntime],
  ]);
  const dependencies: ProxyStatusCoordinatorDependencies = {
    profileManager,
    stateStore,
    logDirectory: '/tmp/logs',
    getRuntime: (profileId) => runtimes.get(profileId),
    readSharedState: async () => options.sharedState,
    resolveApiPort: (port, persisted) => persisted ?? port + 10_000,
    getRuntimePid: () => null,
    isProcessAlive: () => options.alive,
    isPortAvailable: async () => options.portAvailable,
  };
  return { coordinator: new ProxyStatusCoordinator(dependencies), cleared };
}

describe('ProxyStatusCoordinator', () => {
  it('returns a stopped status for an unknown profile', async () => {
    const { coordinator } = setup({ profile: undefined });

    assert.deepEqual(await coordinator.getStatus('missing'), {
      running: false,
      logDirectory: '/tmp/logs',
    });
  });

  it('reads a live shared proxy from persisted state', async () => {
    const { coordinator } = setup({
      sharedState: state({ profileId: SHARED_PROXY_RUNTIME_KEY, pid: 456 }),
      sharedRuntime: runtime(),
    });

    const status = await coordinator.getStatus(profile.id);

    assert.equal(status?.running, true);
    assert.equal(status?.port, 8080);
    assert.equal(status?.apiPort, 18_080);
    assert.equal(status?.pid, 456);
    assert.equal(status?.startedAt, Date.parse('2026-01-01T00:00:00.000Z'));
  });

  it('uses an in-memory profile runtime when no state file exists', async () => {
    const { coordinator } = setup({ profileRuntime: runtime(8090, 18_090) });

    const status = await coordinator.getStatus(profile.id);

    assert.deepEqual(status, {
      running: true,
      port: 8090,
      apiPort: 18_090,
      pid: undefined,
      logDirectory: '/tmp/logs',
    });
  });

  it('clears state when the recorded process is dead', async () => {
    const { coordinator, cleared } = setup({
      state: state(),
      alive: false,
    });

    const status = await coordinator.getStatus(profile.id);

    assert.equal(status?.running, false);
    assert.equal(status?.caCertificatePath, '/tmp/ca.crt');
    assert.deepEqual(cleared, ['/tmp/profile-1']);
  });

  it('keeps a live state when its port is listening', async () => {
    const { coordinator, cleared } = setup({
      state: state({ apiPort: undefined }),
      portAvailable: false,
    });

    const status = await coordinator.getStatus(profile.id);

    assert.equal(status?.running, true);
    assert.equal(status?.apiPort, 18_080);
    assert.deepEqual(cleared, []);
  });

  it('clears state when its process is alive but its port is not listening', async () => {
    const { coordinator, cleared } = setup({
      state: state({ apiPort: undefined }),
      portAvailable: true,
    });

    const status = await coordinator.getStatus(profile.id);

    assert.equal(status?.running, false);
    assert.equal(status?.caCertificatePath, '/tmp/ca.crt');
    assert.deepEqual(cleared, ['/tmp/profile-1']);
  });
});
