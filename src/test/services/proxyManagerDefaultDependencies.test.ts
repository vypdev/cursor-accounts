import '../registerVscodeMock';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IProfileReader } from '../../domain/ports/IProfileReader';
import type { IProxyStateStore } from '../../domain/ports/IProxyStateStore';
import { createDefaultProxyManagerDependencies } from '../../services/proxyManagerDefaultDependencies';

describe('createDefaultProxyManagerDependencies', () => {
  it('composes the certificate, traffic, process, and auth boundaries', () => {
    const profileManager: IProfileReader = {
      getProfiles: async () => [],
      getProfile: async () => undefined,
      findProfileByEmail: async () => undefined,
      findProfileByPath: async () => undefined,
    };
    const stateStore: IProxyStateStore = {
      read: async () => null,
      write: async () => undefined,
      clear: async () => undefined,
    };

    const dependencies = createDefaultProxyManagerDependencies({
      storageDir: '/tmp/cursor-accounts-default-dependencies',
      logDir: '/tmp/cursor-accounts-default-dependencies/logs',
      extensionPath: '/tmp/cursor-accounts-extension',
      context: { extensionPath: '/tmp/cursor-accounts-extension' } as never,
      stateStore,
      profileManager,
      getEstimatedDollarsPerMillionTokens: () => 4,
      getTailFromStart: () => false,
      onDiagnostics: () => undefined,
    });

    assert.equal(typeof dependencies.createProcess, 'function');
    assert.equal(dependencies.authReader !== undefined, true);
    assert.equal(dependencies.certService.getCachedInstalled(), undefined);
    assert.equal(dependencies.trafficIngress.isRunning('profile-1'), false);
    assert.equal(dependencies.trafficIngress.getActivePort(), null);
  });
});
