import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IProxyStateStore } from '../../domain/ports/IProxyStateStore';
import type { IProxyTrafficIngress } from '../../domain/ports/IProxyTrafficIngress';
import type { IProfileManager } from '../../domain/ports/IProfileManager';
import type { Profile } from '@cursor-accounts/types';
import { ProxyTrafficBus } from '../../proxy/proxyTrafficBus';

describe('ProxyManager multi-window', () => {
  it('connectToExistingProxy attaches API ingress without owning the child runtime', async () => {
    const { ProxyManager } = await import('../../services/proxyManager.js');

    const profile: Profile = {
      id: 'profile-a',
      displayName: 'Profile A',
      userDataDir: '/tmp/profile-a',
      proxyEnabled: true,
    } as Profile;

    const stateStore: IProxyStateStore = {
      read: async () => ({
        version: 1,
        profileId: 'profile-a',
        running: true,
        port: 8080,
        apiPort: 19_081,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      }),
      write: async () => undefined,
      clear: async () => undefined,
    };

    const profileManager: IProfileManager = {
      getProfile: async (id: string) => (id === 'profile-a' ? profile : null),
      getProfiles: async () => [profile],
    } as unknown as IProfileManager;

    const trafficBus = new ProxyTrafficBus();
    let ingressCalled = false;
    const trafficIngress: IProxyTrafficIngress = {
      start: async (profileId, port, _mode, options) => {
        ingressCalled = true;
        assert.equal(profileId, 'profile-a');
        assert.equal(port, 8080);
        assert.equal(options?.apiPort, 19_081);
      },
      stop: () => undefined,
      stopAll: () => undefined,
      isRunning: () => false,
      getActivePort: () => null,
    };
    const manager = new ProxyManager({
      stateStore,
      profileManager,
      context: {
        globalStorageUri: { fsPath: '/tmp/cursor-accounts-multi-window' },
        extensionPath: '/tmp/extension',
      } as never,
      storageDir: '/tmp/cursor-accounts-proxy-storage-multi',
      dependencies: {
        certService: {} as never,
        trafficBus,
        trafficIngress,
        createProcess: () => {
          throw new Error('not used');
        },
      },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/status')) {
        return new Response(
          JSON.stringify({
            running: true,
            mitmPort: 8080,
            apiPort: 19_081,
          }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      await manager.connectToExistingProxy('profile-a');
      assert.equal(ingressCalled, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
