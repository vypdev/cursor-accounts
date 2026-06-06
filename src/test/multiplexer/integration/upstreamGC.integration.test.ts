import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { IProfileManager } from '../../../domain/ports/IProfileManager';
import type { IProxyManager } from '../../../domain/ports/IProxyManager';
import { MultiplexerRegistry } from '../../../application/services/multiplexerRegistry';

function createMockProfileManager(): IProfileManager {
  return {
    initialize: async () => undefined,
    getProfiles: async () => [{ id: 'profile-a' } as never],
    getProfile: async () => ({ id: 'profile-a' } as never),
    findProfileByEmail: async () => undefined,
    findProfileByPath: async () => undefined,
    createProfile: async () => {
      throw new Error('not implemented');
    },
    updateProfile: async () => {
      throw new Error('not implemented');
    },
    deleteProfile: async () => undefined,
    validateEmail: () => ({ valid: true, errors: [] }),
    isProfilePathValid: async () => true,
    backup: async () => '/tmp/backup',
    getStats: async () => ({
      totalProfiles: 1,
      profilesWithTheme: 0,
      averageAge: 0,
    }),
  };
}

function createMockProxyManager(): IProxyManager {
  return {
    start: async () => ({ success: true, port: 8080 }),
    startUpstream: async () => ({ success: true, port: 8100 }),
    stop: async () => undefined,
    stopUpstream: async () => undefined,
    getRuntimeMetadata: () => undefined,
    restartProfileProxy: async () => ({ success: true, port: 8080 }),
    getStatus: async () => null,
    isRunning: async () => false,
    isCurrentWindowUsingProxy: async () => false,
    getCertificatePath: async () => '/tmp/ca.pem',
    getLogDirectory: () => '/tmp/logs',
    getProxyInstallGuide: async () => ({
      platform: 'darwin',
      certAvailable: true,
      certPath: '/tmp/ca.pem',
      title: 'Install',
      intro: 'Intro',
      steps: [],
    }),
    installCertificate: async () => ({ success: true }),
    uninstallCertificate: async () => ({ success: true }),
    checkCertificateInstalled: async () => true,
    getCachedCertificateInstalled: () => true,
    getProxyServerUrl: async () => null,
    getAllUsedPorts: async () => [],
    ensureProfileProxy: async () => ({ success: true, port: 8080 }),
    restoreAllProfileProxySettings: async () => ({ restored: 0, errors: [] }),
    onStatusChange: () => undefined,
    ensureOutputTailer: async () => undefined,
    ensureTrafficTailer: async () => undefined,
    showOutputChannel: () => undefined,
    showTokenDetectorChannel: () => undefined,
  };
}

type RegistryInternals = {
  cleanupIdleUpstreams(): Promise<void>;
};

describe('Upstream garbage collection', { concurrency: 1 }, () => {
  const registries: MultiplexerRegistry[] = [];

  afterEach(async () => {
    for (const registry of registries.splice(0)) {
      await registry.stopAll();
    }
  });

  function createRegistry(): MultiplexerRegistry {
    const registry = new MultiplexerRegistry(
      createMockProxyManager(),
      createMockProfileManager()
    );
    registries.push(registry);
    return registry;
  }

  function internals(registry: MultiplexerRegistry): RegistryInternals {
    return registry as unknown as RegistryInternals;
  }

  it('removes upstreams after TTL without activity', async () => {
    const registry = createRegistry();
    await registry.ensureStarted();

    const upstreamId = await registry.createUpstreamForWorkspace(
      'profile-a',
      '/workspace/idle'
    );

    const runtime = registry.getRuntime();
    assert.ok(runtime?.upstreamPool.getById(upstreamId));

    await internals(registry).cleanupIdleUpstreams();

    assert.equal(runtime?.upstreamPool.getById(upstreamId), undefined);
  });

  it('keeps active upstreams alive', async () => {
    const registry = createRegistry();
    await registry.ensureStarted();

    const upstreamId = await registry.createUpstreamForWorkspace(
      'profile-a',
      '/workspace/active'
    );

    registry.recordUpstreamActivity('profile-a', upstreamId);

    const runtime = registry.getRuntime();
    await internals(registry).cleanupIdleUpstreams();

    assert.ok(runtime?.upstreamPool.getById(upstreamId));
  });
});
