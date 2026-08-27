import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProxyTrafficSummary } from '../../proxy/types';
import type { RestoreAllProfilesResult } from '../../domain/ports/IProxyManager';
import type { IProfileManager } from '../../domain/ports/IProfileManager';
import type { IProxyStateStore } from '../../domain/ports/IProxyStateStore';
import type { IProxySettingsRestorer } from '../../domain/ports/IProxySettingsRestorer';
import { ProxyTrafficBus } from '../../proxy/proxyTrafficBus';
import { createProxyCostEnricher } from '../../proxy/proxyCostEnricher';
import { ProxyTrafficIngress } from '../../proxy/proxyTrafficIngress';

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

function createTrafficBus(): ProxyTrafficBus {
  return new ProxyTrafficBus(createProxyCostEnricher(() => 4));
}

describe('ProxyManager integration', () => {
  it('forwards traffic summaries from the traffic bus to onTraffic listeners', async () => {
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

    const trafficBus = createTrafficBus();
    const manager = new ProxyManager({
      stateStore,
      profileManager,
      context: {
        globalStorageUri: { fsPath: '/tmp/cursor-accounts-proxy-test' },
        extensionPath: '/tmp/extension',
      } as never,
      storageDir: '/tmp/cursor-accounts-proxy-storage',
      dependencies: {
        certService: {
          ensureCaCertificate: async () => '/tmp/ca.pem',
        } as never,
        trafficBus,
        trafficIngress: new ProxyTrafficIngress('/tmp/logs', trafficBus, () => false),
        createProcess: () => {
          throw new Error('not used');
        },
      },
    });

    const received: ProxyTrafficSummary[] = [];
    manager.onTraffic((summary) => {
      received.push(summary);
    });

    trafficBus.publish(sampleTraffic(), 'profile-a');

    assert.equal(received.length, 1);
    assert.equal(received[0]?.host, 'api2.cursor.sh');
    assert.equal(
      received[0]?.insights?.agent?.estimatedCostUsd,
      0.0048
    );
  });

  it('continues notifying listeners when one listener throws', async () => {
    const { ProxyManager } = await import('../../services/proxyManager.js');
    const trafficBus = createTrafficBus();

    const manager = new ProxyManager({
      stateStore: {
        read: async () => null,
        write: async () => undefined,
        clear: async () => undefined,
      },
      profileManager: { getProfile: async () => null, getProfiles: async () => [] } as unknown as IProfileManager,
      context: {
        globalStorageUri: { fsPath: '/tmp/cursor-accounts-proxy-test-2' },
        extensionPath: '/tmp/extension',
      } as never,
      storageDir: '/tmp/cursor-accounts-proxy-storage-2',
      dependencies: {
        certService: {} as never,
        trafficBus,
        trafficIngress: new ProxyTrafficIngress('/tmp/logs', trafficBus, () => false),
        createProcess: () => {
          throw new Error('not used');
        },
      },
    });

    let okCount = 0;
    manager.onTraffic(() => {
      throw new Error('listener failed');
    });
    manager.onTraffic(() => {
      okCount += 1;
    });

    trafficBus.publish(sampleTraffic(), 'p');
    assert.equal(okCount, 1);
  });

  it('restoreAllProfileProxySettings delegates to the settings restorer', async () => {
    const { ProxyManager } = await import('../../services/proxyManager.js');

    const expected: RestoreAllProfilesResult = {
      restored: 2,
      errors: [{ profileId: 'x', error: 'disk' }],
    };

    const proxySettingsRestorer: IProxySettingsRestorer = {
      restoreAllProfiles: async () => expected,
    };

    const manager = new ProxyManager({
      stateStore: {
        read: async () => null,
        write: async () => undefined,
        clear: async () => undefined,
      },
      profileManager: { getProfile: async () => null, getProfiles: async () => [] } as unknown as IProfileManager,
      context: {
        globalStorageUri: { fsPath: '/tmp/cursor-accounts-proxy-test-3' },
        extensionPath: '/tmp/extension',
      } as never,
      storageDir: '/tmp/cursor-accounts-proxy-storage-3',
      proxySettingsRestorer,
    });

    const result = await manager.restoreAllProfileProxySettings();
    assert.deepEqual(result, expected);
  });

  it('restoreAllProfileProxySettings returns empty result without settings service', async () => {
    const { ProxyManager } = await import('../../services/proxyManager.js');

    const manager = new ProxyManager({
      stateStore: {
        read: async () => null,
        write: async () => undefined,
        clear: async () => undefined,
      },
      profileManager: { getProfile: async () => null, getProfiles: async () => [] } as unknown as IProfileManager,
      context: {
        globalStorageUri: { fsPath: '/tmp/cursor-accounts-proxy-test-4' },
        extensionPath: '/tmp/extension',
      } as never
    });

    const result = await manager.restoreAllProfileProxySettings();
    assert.deepEqual(result, { restored: 0, errors: [] });
  });
});
