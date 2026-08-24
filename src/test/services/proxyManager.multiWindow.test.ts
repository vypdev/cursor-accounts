import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IProxyStateStore } from '../../domain/ports/IProxyStateStore';
import type { IProfileManager } from '../../domain/ports/IProfileManager';
import type { Profile } from '@cursor-accounts/types';
import { ProxyTrafficBus } from '../../proxy/proxyTrafficBus';
import { ProxyTrafficIngress } from '../../proxy/proxyTrafficIngress';

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
    const manager = new ProxyManager(
      stateStore,
      profileManager,
      {
        globalStorageUri: { fsPath: '/tmp/cursor-accounts-multi-window' },
        extensionPath: '/tmp/extension',
      } as never,
      '/tmp/cursor-accounts-proxy-storage-multi',
      undefined,
      undefined,
      undefined,
      undefined,
      {
        certService: {} as never,
        trafficBus,
        trafficIngress: new ProxyTrafficIngress('/tmp/logs', trafficBus, () => false),
        createProcess: () => {
          throw new Error('not used');
        },
      }
    );

    let ingressCalled = false;
    const internal = manager as unknown as {
      ensureAgentTracking(profileId: string, userDataDir: string): Promise<void>;
      ensureTrafficIngress(
        profileId: string,
        mitmPort: number,
        apiPort: number,
        options?: { forceRestart?: boolean }
      ): Promise<void>;
    };
    internal.ensureAgentTracking = async () => undefined;
    internal.ensureTrafficIngress = async (profileId, mitmPort, apiPort) => {
      ingressCalled = true;
      assert.equal(profileId, 'profile-a');
      assert.equal(mitmPort, 8080);
      assert.equal(apiPort, 19_081);
    };

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
