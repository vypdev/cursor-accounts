import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { IProfileManager } from '../../../../domain/ports/IProfileManager';
import type { IProxyManager } from '../../../../domain/ports/IProxyManager';
import { MultiplexerRegistry } from '../../../../application/services/multiplexerRegistry';

function createMockProfileManager(): IProfileManager {
  return {
    initialize: async () => undefined,
    getProfiles: async () => [
      { id: 'profile-a', email: 'a@example.com' } as never,
      { id: 'profile-b', email: 'b@example.com' } as never,
    ],
    getProfile: async (id) =>
      id === 'profile-a' || id === 'profile-b'
        ? ({ id, email: `${id}@example.com` } as never)
        : undefined,
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
      totalProfiles: 2,
      profilesWithTheme: 0,
      averageAge: 0,
    }),
  };
}

function createMockProxyManager(): IProxyManager & {
  startUpstreamCalls: Array<{
    upstreamId: string;
    profileId: string;
    workspacePath: string;
  }>;
  stopUpstreamCalls: string[];
} {
  const startUpstreamCalls: Array<{
    upstreamId: string;
    profileId: string;
    workspacePath: string;
  }> = [];
  const stopUpstreamCalls: string[] = [];

  return {
    startUpstreamCalls,
    stopUpstreamCalls,
    start: async () => ({ success: true, port: 8080 }),
    startUpstream: async (upstreamId, options) => {
      startUpstreamCalls.push({
        upstreamId,
        profileId: options.profileId,
        workspacePath: options.workspacePath,
      });
      return { success: true, port: 8100 + startUpstreamCalls.length };
    },
    stop: async () => undefined,
    stopUpstream: async (upstreamId) => {
      stopUpstreamCalls.push(upstreamId);
    },
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

describe('MultiplexerRegistry', { concurrency: 1 }, () => {
  const registries: MultiplexerRegistry[] = [];

  afterEach(async () => {
    for (const registry of registries.splice(0)) {
      await registry.stopAll();
    }
  });

  function createRegistry(proxyManager = createMockProxyManager()): {
    registry: MultiplexerRegistry;
    proxyManager: ReturnType<typeof createMockProxyManager>;
  } {
    const registry = new MultiplexerRegistry(
      proxyManager,
      createMockProfileManager()
    );
    registries.push(registry);
    return { registry, proxyManager };
  }

  it('singleton reuses global multiplexer on port 9000', async () => {
    const { registry } = createRegistry();

    await registry.ensureStarted();
    await registry.ensureStarted();

    assert.equal(registry.isRunning(), true);
    assert.equal(registry.getProxyServerUrl(), 'http://127.0.0.1:9000');
    assert.equal(registry.getRuntime()?.service.getConfig()?.router.port, 9000);
  });

  it('creates upstream dynamically for profile and workspace', async () => {
    const { registry, proxyManager } = createRegistry();
    await registry.ensureStarted();

    const upstreamId = await registry.createUpstreamForWorkspace(
      'profile-a',
      '/workspace/project-x'
    );

    assert.ok(upstreamId);
    assert.equal(proxyManager.startUpstreamCalls.length, 1);
    assert.equal(proxyManager.startUpstreamCalls[0]?.profileId, 'profile-a');
    assert.equal(
      proxyManager.startUpstreamCalls[0]?.workspacePath,
      '/workspace/project-x'
    );
  });

  it('stopUpstreamsForProfile removes upstreams without stopping global router', async () => {
    const { registry, proxyManager } = createRegistry();
    await registry.ensureStarted();
    await registry.createUpstreamForWorkspace('profile-a', '/workspace/a');

    await registry.stopUpstreamsForProfile('profile-a');

    assert.equal(registry.isRunning(), true);
    assert.ok(proxyManager.stopUpstreamCalls.length >= 1);
    assert.equal(registry.listUpstreamsForProfile('profile-a').length, 0);
  });

  it('stopAll stops global multiplexer and all upstreams', async () => {
    const { registry, proxyManager } = createRegistry();
    await registry.ensureStarted();
    await registry.createUpstreamForWorkspace('profile-a', '/workspace/a');

    await registry.stopAll();

    assert.equal(registry.isRunning(), false);
    assert.ok(proxyManager.stopUpstreamCalls.length >= 1);
  });
});
