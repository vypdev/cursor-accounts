import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IProxyStateStore } from '../../domain/ports/IProxyStateStore';
import type { IProfileManager } from '../../domain/ports/IProfileManager';
import type { Profile } from '@cursor-accounts/types';
import { ProxyTrafficBus } from '../../proxy/proxyTrafficBus';
import { ProxyTrafficIngress } from '../../proxy/proxyTrafficIngress';
import { SHARED_PROXY_RUNTIME_KEY } from '../../proxy/types';

describe('ProxyManager shared proxy', () => {
  it('getStatus returns shared proxy status for proxy-enabled profiles', async () => {
    const { ProxyManager } = await import('../../services/proxyManager.js');

    const profile: Profile = {
      id: 'profile-a',
      displayName: 'Profile A',
      userDataDir: '/tmp/profile-a',
      proxyEnabled: true,
    } as Profile;

    const stateStore: IProxyStateStore = {
      read: async () => null,
      write: async () => undefined,
      clear: async () => undefined,
    };

    const profileManager: IProfileManager = {
      getProfile: async (id: string) => (id === 'profile-a' ? profile : null),
      getProfiles: async () => [profile],
    } as unknown as IProfileManager;

    const trafficBus = new ProxyTrafficBus();
    const manager = new ProxyManager(
      stateStore,
      profileManager,
      {
        globalStorageUri: { fsPath: '/tmp/cursor-accounts-shared-proxy' },
        extensionPath: '/tmp/extension',
      } as never,
      '/tmp/cursor-accounts-proxy-storage-shared',
      undefined,
      undefined,
      undefined,
      undefined,
      {
        certService: {} as never,
        trafficBus,
        trafficIngress: new ProxyTrafficIngress('/tmp/logs', trafficBus, () => false),
        sharedStateStore: {
          read: async () => ({
            version: 1,
            profileId: 'shared-proxy',
            running: true,
            port: 8080,
            apiPort: 18_080,
            pid: process.pid,
            startedAt: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString(),
          }),
          write: async () => undefined,
          clear: async () => undefined,
        },
        createProcess: () => {
          throw new Error('not used');
        },
      }
    );

    const internal = manager as unknown as {
      runtimes: Map<
        string,
        { process: unknown; port: number; apiPort: number; userDataDir: string }
      >;
    };

    internal.runtimes.set(SHARED_PROXY_RUNTIME_KEY, {
      process: {},
      port: 8080,
      apiPort: 18_080,
      userDataDir: '/tmp/cursor-accounts-proxy-storage-shared',
    });

    const status = await manager.getStatus('profile-a');
    assert.equal(status?.running, true);
    assert.equal(status?.port, 8080);
    assert.equal(status?.apiPort, 18_080);
  });

  it('start delegates to ensureSharedProxy for proxy-enabled profiles', async () => {
    const { ProxyManager } = await import('../../services/proxyManager.js');

    const profile: Profile = {
      id: 'profile-a',
      displayName: 'Profile A',
      userDataDir: '/tmp/profile-a',
      proxyEnabled: true,
    } as Profile;

    const manager = new ProxyManager(
      {
        read: async () => null,
        write: async () => undefined,
        clear: async () => undefined,
      },
      {
        getProfile: async () => profile,
        getProfiles: async () => [profile],
      } as never,
      {
        globalStorageUri: { fsPath: '/tmp/cursor-accounts-shared-proxy-2' },
        extensionPath: '/tmp/extension',
      } as never,
      '/tmp/cursor-accounts-proxy-storage-shared-2',
      undefined,
      undefined,
      undefined,
      undefined,
      {
        certService: {} as never,
        trafficBus: new ProxyTrafficBus(),
        trafficIngress: new ProxyTrafficIngress(
          '/tmp/logs',
          new ProxyTrafficBus(),
          () => false
        ),
        createProcess: () => {
          throw new Error('not used');
        },
      }
    );

    let ensureSharedCalled = false;
    (manager as unknown as {
      ensureSharedProxy(profiles: Profile[]): Promise<{ success: boolean; port?: number }>;
    }).ensureSharedProxy = async () => {
      ensureSharedCalled = true;
      return { success: true, port: 8080 };
    };

    const result = await manager.start('profile-a');
    assert.equal(ensureSharedCalled, true);
    assert.equal(result.success, true);
    assert.equal(result.port, 8080);
  });
});
