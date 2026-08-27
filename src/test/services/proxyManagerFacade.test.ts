import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IProfileReader } from '../../domain/ports/IProfileReader';
import type { IProxyStateStore } from '../../domain/ports/IProxyStateStore';
import type {
  IProxyTrafficBus,
  TrafficListener,
} from '../../domain/ports/IProxyTrafficBus';
import type { IProxyTrafficIngress } from '../../domain/ports/IProxyTrafficIngress';
import type { Profile } from '@cursor-accounts/types';
import { ProxyManager } from '../../services/proxyManager';
import type {
  ProxyManagerComposition,
  ProxyManagerCompositionOptions,
} from '../../services/proxyManagerComposition';
import type { ProxyManagerDependencies } from '../../services/proxyManagerDefaultDependencies';

describe('ProxyManager facade', () => {
  it('delegates lifecycle, status, certificate, output, and routing operations', async () => {
    const calls: string[] = [];
    const profile = makeProfile();
    let status = {
      running: true,
      port: 8080,
      apiPort: 18080,
    } as never;
    let compositionCallbacks: ProxyManagerCompositionOptions['callbacks'] | undefined;
    const composition = createCompositionHarness(calls, () => status);
    const manager = new ProxyManager({
      stateStore: createStateStore(),
      profileManager: createProfileReader(profile),
      context: { extensionPath: '/tmp/extension' } as never,
      storageDir: '/tmp/proxy-manager-facade',
      dependencies: createDependencies(calls),
      getOutputConfig: () => ({
        logTrafficToOutput: true,
        autoShowOutputChannel: false,
        outputCursorHostsOnly: false,
      }),
      compositionFactory: (options) => {
        compositionCallbacks = options.callbacks;
        return composition;
      },
    });

    const startResult = await manager.start(profile.id);
    assert.deepEqual(startResult, { success: true, port: 8080 });
    assert.deepEqual(await manager.ensureProfileProxy(profile.id), {
      success: true,
      port: 8080,
    });
    assert.deepEqual(await manager.start('missing'), {
      success: false,
      error: 'Profile missing not found',
    });
    await manager.connectToExistingProxy(profile.id);
    await manager.stop(profile.id, { restoreSettings: true });
    await manager.stopAll();
    assert.equal(await manager.getStatus(profile.id), status);
    assert.equal(await manager.isRunning(profile.id), true);
    assert.equal(await manager.isCurrentWindowUsingProxy(), false);
    assert.equal(await manager.getCertificatePath(), '/tmp/ca.pem');
    assert.equal(manager.getAgentTrackingService(profile.id), undefined);
    assert.equal(await manager.checkCertificateInstalled(), true);
    assert.equal(manager.getCachedCertificateInstalled(), true);
    assert.deepEqual(await manager.installCertificate(), { success: true });
    assert.deepEqual(await manager.uninstallCertificate(), { success: true });
    assert.equal(
      (await manager.getProxyInstallGuide()).platform,
      'linux'
    );
    assert.equal(await manager.getProxyServerUrl(profile.id), 'http://127.0.0.1:8080');
    assert.deepEqual(await manager.getAllUsedPorts(), []);
    assert.deepEqual(await manager.restoreAllProfileProxySettings(), {
      restored: 0,
      errors: [],
    });
    assert.equal(manager.getLogDirectory(), '/tmp/proxy-manager-facade/logs');
    assert.deepEqual(await manager.clearLogFiles(), {
      deletedFiles: 0,
      deletedBytes: 0,
    });
    manager.showTokenDetectorChannel();
    await manager.ensureOutputTailer(profile.id, { tailFromStart: true });
    await manager.ensureTrafficTailer();
    manager.showOutputChannel();

    const originalArgv = process.argv;
    const originalCaCerts = process.env.NODE_EXTRA_CA_CERTS;
    try {
      process.argv = [...originalArgv, '--proxy-server=http://127.0.0.1:8080'];
      delete process.env.NODE_EXTRA_CA_CERTS;
      assert.equal(await manager.isCurrentWindowUsingProxy(), true);

      process.argv = originalArgv;
      process.env.NODE_EXTRA_CA_CERTS = '/tmp/ca.pem';
      assert.equal(await manager.isCurrentWindowUsingProxy(), true);
    } finally {
      process.argv = originalArgv;
      if (originalCaCerts === undefined) {
        delete process.env.NODE_EXTRA_CA_CERTS;
      } else {
        process.env.NODE_EXTRA_CA_CERTS = originalCaCerts;
      }
    }

    status = { running: false } as never;
    assert.equal(await manager.getProxyServerUrl(profile.id), null);
    status = { running: true } as never;
    assert.equal(await manager.getProxyServerUrl(profile.id), null);
    status = { running: true, port: 8080 } as never;
    assert.deepEqual(calls, [
      'shared-ensure',
      'shared-ensure',
      'connect',
      'profile-stop',
      'shared-stop',
      'output-clear',
      'show-token',
      'output-tailer',
      'traffic-tailer',
      'show-output',
    ]);

    status = { running: false } as never;
    assert.deepEqual(await manager.restartProfileProxy(profile.id), {
      success: true,
    });
    assert.equal(compositionCallbacks !== undefined, true);
  });

  it('publishes traffic and status callbacks, then unsubscribes exactly once on dispose', async () => {
    const calls: string[] = [];
    const profile = makeProfile();
    const listeners: TrafficListener[] = [];
    const unsubscriptions: number[] = [];
    const trafficBus: IProxyTrafficBus = {
      publish: () => {},
      subscribe: (listener) => {
        const index = listeners.length;
        listeners.push(listener);
        return () => unsubscriptions.push(index);
      },
    };
    let callbacks: ProxyManagerCompositionOptions['callbacks'] | undefined;
    const composition = createCompositionHarness(calls, () => ({ running: false }));
    const manager = new ProxyManager({
      stateStore: createStateStore(),
      profileManager: createProfileReader(profile),
      context: { extensionPath: '/tmp/extension' } as never,
      storageDir: '/tmp/proxy-manager-callbacks',
      dependencies: createDependencies(calls, trafficBus),
      compositionFactory: (options) => {
        callbacks = options.callbacks;
        return composition;
      },
    });

    let statusChanges = 0;
    let usageEvents = 0;
    let externalTraffic = 0;
    manager.onStatusChange(() => {
      statusChanges += 1;
    });
    manager.onConversationUsagePersisted(() => {
      usageEvents += 1;
    });
    manager.onTraffic(() => {
      externalTraffic += 1;
    });

    callbacks?.notifyStatusChange();
    callbacks?.notifyUsagePersisted({
      conversationId: 'conversation-a',
      profileId: profile.id,
    });
    listeners[1]?.({} as never);
    listeners[0]?.({} as never, profile.id);
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(statusChanges, 1);
    assert.equal(usageEvents, 1);
    assert.equal(externalTraffic, 1);
    assert.deepEqual(calls, ['traffic-handle', 'traffic-present']);

    manager.dispose();
    manager.dispose();
    assert.deepEqual(unsubscriptions, [0, 1]);
    assert.deepEqual(calls, [
      'traffic-handle',
      'traffic-present',
      'ingress-stop',
    ]);
  });
});

function createCompositionHarness(
  calls: string[],
  getStatus: () => unknown
): ProxyManagerComposition {
  return {
    storageDir: '/tmp/proxy-manager-facade',
    logDir: '/tmp/proxy-manager-facade/logs',
    agentTrackingCoordinator: {} as never,
    trafficIngressCoordinator: {} as never,
    trafficUsageCoordinator: {
      handle: async () => {
        calls.push('traffic-handle');
        return 'profile-a';
      },
    } as never,
    sharedProxyLifecycleCoordinator: {
      ensure: async () => {
        calls.push('shared-ensure');
        return { success: true, port: 8080 };
      },
      stop: async () => {
        calls.push('shared-stop');
      },
    } as never,
    profileLifecycleCoordinator: {
      connectToExistingProxy: async () => {
        calls.push('connect');
      },
      stop: async () => {
        calls.push('profile-stop');
      },
    } as never,
    statusCoordinator: {
      getStatus: async () => getStatus(),
    } as never,
    trafficTailerCoordinator: {} as never,
    outputCoordinator: {
      getLogDirectory: () => '/tmp/proxy-manager-facade/logs',
      clearLogFiles: async () => {
        calls.push('output-clear');
        return { deletedFiles: 0, deletedBytes: 0 };
      },
      showTokenDetectorChannel: () => calls.push('show-token'),
      ensureOutputTailer: async () => calls.push('output-tailer'),
      ensureTrafficTailer: async () => calls.push('traffic-tailer'),
      showOutputChannel: () => calls.push('show-output'),
      presentTraffic: () => calls.push('traffic-present'),
    } as never,
    isSharedProxyActive: () => true,
    getAgentTrackingService: () => undefined,
    getApiToken: async () => undefined,
  };
}

function createDependencies(
  calls: string[],
  trafficBus: IProxyTrafficBus = {
    publish: () => {},
    subscribe: () => () => {},
  }
): ProxyManagerDependencies {
  const trafficIngress: IProxyTrafficIngress = {
    start: async () => {},
    stop: () => {},
    stopAll: () => calls.push('ingress-stop'),
    isRunning: () => false,
    getActivePort: () => null,
  };
  return {
    certService: {
      ensureCaCertificate: async () => '/tmp/ca.pem',
      getCertificatePath: async () => '/tmp/ca.pem',
      checkInstalled: async () => true,
      getCachedInstalled: () => true,
      install: async () => ({ success: true }),
      uninstall: async () => ({ success: true }),
      getInstallGuide: async () => ({
        platform: 'linux',
        certAvailable: true,
        title: 'Proxy certificate',
        intro: 'Install the certificate',
        steps: [],
      }),
    },
    trafficBus,
    trafficIngress,
    createProcess: () => ({}) as never,
  } as ProxyManagerDependencies;
}

function createStateStore(): IProxyStateStore {
  return {
    read: async () => null,
    write: async () => {},
    clear: async () => {},
  };
}

function createProfileReader(profile: Profile): IProfileReader {
  return {
    getProfiles: async () => [profile],
    getProfile: async (id) => (id === profile.id ? profile : undefined),
    findProfileByEmail: async () => undefined,
    findProfileByPath: async () => undefined,
  };
}

function makeProfile(): Profile {
  return {
    id: 'profile-a',
    email: 'a@example.com',
    slug: 'a-example-com',
    displayName: 'Profile A',
    userDataDir: '/tmp/profile-a',
    created: '2024-01-01T00:00:00.000Z',
    proxyEnabled: true,
  };
}
