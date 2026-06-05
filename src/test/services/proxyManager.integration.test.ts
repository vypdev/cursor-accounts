import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProxyTrafficSummary } from '../../proxy/types';
import type { RestoreAllProfilesResult } from '../../domain/ports/IProxyManager';
import type { IProfileManager } from '../../domain/ports/IProfileManager';
import type { IProxyStateStore } from '../../domain/ports/IProxyStateStore';
import type { ProxySettingsService } from '../../services/proxySettingsService';

function sampleTraffic(): ProxyTrafficSummary {
  return {
    timestamp: new Date().toISOString(),
    kind: 'response',
    url: 'https://api2.cursor.sh/agent.v1.AgentService/RunSSE',
    host: 'api2.cursor.sh',
    endpoint: '/agent.v1.AgentService/RunSSE',
    insights: {
      agent: {
        streamingTokens: 1200,
        outputTokens: 800,
        inputTokens: 400,
        usageEvent: 'token_delta',
      },
    },
  };
}

describe('ProxyManager integration', () => {
  it('forwards IPC traffic summaries to onTraffic listeners', async () => {
    const { ProxyManager } = await import('../../services/proxyManager.js');

    const stateStore: IProxyStateStore = {
      read: async () => null,
      write: async () => undefined,
      clear: async () => undefined,
    };

    const profileManager: IProfileManager = {
      getProfile: async () => null,
      getProfiles: async () => [],
    } as unknown as IProfileManager;

    const manager = new ProxyManager(
      stateStore,
      profileManager,
      {
        globalStorageUri: { fsPath: '/tmp/cursor-accounts-proxy-test' },
        extensionPath: '/tmp/extension',
      } as never,
      '/tmp/cursor-accounts-proxy-storage'
    );

    const received: ProxyTrafficSummary[] = [];
    manager.onTraffic((summary) => {
      received.push(summary);
    });

    const internal = manager as unknown as {
      handleChildMessage(profileId: string, msg: unknown): void;
    };
    internal.handleChildMessage('profile-a', {
      type: 'traffic',
      summary: sampleTraffic(),
    });

    assert.equal(received.length, 1);
    assert.equal(received[0]?.host, 'api2.cursor.sh');
    assert.equal(
      received[0]?.insights?.agent?.estimatedCostUsd,
      0.0048
    );
  });

  it('continues notifying listeners when one listener throws', async () => {
    const { ProxyManager } = await import('../../services/proxyManager.js');

    const manager = new ProxyManager(
      {
        read: async () => null,
        write: async () => undefined,
        clear: async () => undefined,
      },
      { getProfile: async () => null, getProfiles: async () => [] } as unknown as IProfileManager,
      {
        globalStorageUri: { fsPath: '/tmp/cursor-accounts-proxy-test-2' },
        extensionPath: '/tmp/extension',
      } as never,
      '/tmp/cursor-accounts-proxy-storage-2'
    );

    let okCount = 0;
    manager.onTraffic(() => {
      throw new Error('listener failed');
    });
    manager.onTraffic(() => {
      okCount += 1;
    });

    const internal = manager as unknown as {
      handleChildMessage(profileId: string, msg: unknown): void;
    };
    internal.handleChildMessage('p', {
      type: 'traffic',
      summary: sampleTraffic(),
    });

    assert.equal(okCount, 1);
  });

  it('restoreAllProfileProxySettings delegates to ProxySettingsService', async () => {
    const { ProxyManager } = await import('../../services/proxyManager.js');

    const expected: RestoreAllProfilesResult = {
      restored: 2,
      errors: [{ profileId: 'x', error: 'disk' }],
    };

    const proxySettingsService = {
      restoreAllProfiles: async () => expected,
    } as unknown as ProxySettingsService;

    const manager = new ProxyManager(
      {
        read: async () => null,
        write: async () => undefined,
        clear: async () => undefined,
      },
      { getProfile: async () => null, getProfiles: async () => [] } as unknown as IProfileManager,
      {
        globalStorageUri: { fsPath: '/tmp/cursor-accounts-proxy-test-3' },
        extensionPath: '/tmp/extension',
      } as never,
      '/tmp/cursor-accounts-proxy-storage-3',
      proxySettingsService
    );

    const result = await manager.restoreAllProfileProxySettings();
    assert.deepEqual(result, expected);
  });

  it('restoreAllProfileProxySettings returns empty result without settings service', async () => {
    const { ProxyManager } = await import('../../services/proxyManager.js');

    const manager = new ProxyManager(
      {
        read: async () => null,
        write: async () => undefined,
        clear: async () => undefined,
      },
      { getProfile: async () => null, getProfiles: async () => [] } as unknown as IProfileManager,
      {
        globalStorageUri: { fsPath: '/tmp/cursor-accounts-proxy-test-4' },
        extensionPath: '/tmp/extension',
      } as never
    );

    const result = await manager.restoreAllProfileProxySettings();
    assert.deepEqual(result, { restored: 0, errors: [] });
  });
});
