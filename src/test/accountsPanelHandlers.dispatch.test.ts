import './registerVscodeMock';
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { FromWebviewMessage } from '../profiles/types';
import {
  AccountsPanelHandlers,
  type AccountsPanelHandlerDeps,
} from '../ui/accountsPanelHandlers';

function createHandlers() {
  const handlers = new AccountsPanelHandlers(
    {
      profileManager: {} as never,
      profileLauncher: {} as never,
      profileDetector: {} as never,
      efficiencyService: {} as never,
      authReader: {} as never,
      instanceDetector: {} as never,
      storageCleanupService: {} as never,
      storageAnalyzer: {} as never,
      profileWorkspaceService: {} as never,
      proxyManager: {} as never,
      profileProxyEditUseCase: { execute: async () => ({} as never) },
    } satisfies AccountsPanelHandlerDeps,
    {
      postMessage: async () => undefined,
      refresh: async () => undefined,
      refreshInstances: async () => undefined,
      refreshGithubSummaries: async () => undefined,
      refreshProxyStatus: mock.fn(async () => undefined),
      hasActiveWebview: () => true,
    }
  );

  return {
    handlers,
    internals: handlers as unknown as {
      launchHandlers: { launch: ReturnType<typeof mock.fn> };
      profileHandlers: {
        add: ReturnType<typeof mock.fn>;
        edit: ReturnType<typeof mock.fn>;
        delete: ReturnType<typeof mock.fn>;
        showInExplorer: ReturnType<typeof mock.fn>;
        exportProfiles: ReturnType<typeof mock.fn>;
        importProfiles: ReturnType<typeof mock.fn>;
      };
      suggestedProfileHandlers: { request: ReturnType<typeof mock.fn> };
      efficiencyHandlers: { toggle: ReturnType<typeof mock.fn> };
      storageHandlers: {
        requestInfo: ReturnType<typeof mock.fn>;
        clean: ReturnType<typeof mock.fn>;
      };
      githubHandlers: {
        configure: ReturnType<typeof mock.fn>;
        clear: ReturnType<typeof mock.fn>;
      };
      proxyHandlers: {
        start: ReturnType<typeof mock.fn>;
        stop: ReturnType<typeof mock.fn>;
        showLogs: ReturnType<typeof mock.fn>;
        showTraffic: ReturnType<typeof mock.fn>;
        getInstallGuide: ReturnType<typeof mock.fn>;
        installCertificate: ReturnType<typeof mock.fn>;
        uninstallCertificate: ReturnType<typeof mock.fn>;
        saveCertificate: ReturnType<typeof mock.fn>;
      };
      callbacks: { refreshProxyStatus: ReturnType<typeof mock.fn> };
    },
  };
}

function asyncSpy() {
  return mock.fn(async (..._args: unknown[]) => undefined);
}

describe('AccountsPanelHandlers dispatch', () => {
  it('routes every webview action to its specialized boundary', async () => {
    const { handlers, internals } = createHandlers();
    internals.launchHandlers = { launch: asyncSpy() };
    internals.profileHandlers = {
      add: asyncSpy(),
      edit: asyncSpy(),
      delete: asyncSpy(),
      showInExplorer: asyncSpy(),
      exportProfiles: asyncSpy(),
      importProfiles: asyncSpy(),
    };
    internals.suggestedProfileHandlers = { request: asyncSpy() };
    internals.efficiencyHandlers = { toggle: asyncSpy() };
    internals.storageHandlers = {
      requestInfo: asyncSpy(),
      clean: asyncSpy(),
    };
    internals.githubHandlers = {
      configure: asyncSpy(),
      clear: asyncSpy(),
    };
    internals.proxyHandlers = {
      start: asyncSpy(),
      stop: asyncSpy(),
      showLogs: asyncSpy(),
      showTraffic: asyncSpy(),
      getInstallGuide: asyncSpy(),
      installCertificate: asyncSpy(),
      uninstallCertificate: asyncSpy(),
      saveCertificate: asyncSpy(),
    };

    const messages: FromWebviewMessage[] = [
      { type: 'launch', profileId: 'profile-1', projectPath: '/workspace' },
      { type: 'add', email: 'user@example.com' },
      { type: 'edit', profileId: 'profile-1', updates: { displayName: 'User' } },
      { type: 'delete', profileId: 'profile-1' },
      { type: 'showInExplorer', profileId: 'profile-1' },
      { type: 'export', profileIds: ['profile-1'], includeSettings: true },
      {
        type: 'import',
        data: '{"profiles":[]}',
        options: {
          skipDuplicates: true,
          overwriteExisting: false,
          importSettings: true,
          strictValidation: true,
        },
      },
      { type: 'requestSuggestedProfile' },
      { type: 'toggleEfficiency', profileId: 'profile-1', enabled: true },
      { type: 'requestStorageInfo', profileId: 'profile-1' },
      {
        type: 'cleanStorage',
        profileId: 'profile-1',
        options: { action: 'deleteOldChats' },
      },
      { type: 'configureGithubToken', profileId: 'profile-1' },
      { type: 'clearGithubToken', profileId: 'profile-1' },
      { type: 'startProxy' },
      { type: 'stopProxy' },
      { type: 'showProxyLogs' },
      { type: 'showProxyTraffic' },
      { type: 'getProxyInstallGuide' },
      { type: 'installProxyCertificate' },
      { type: 'uninstallProxyCertificate' },
      { type: 'saveProxyCertificate' },
      { type: 'refreshProxyStatus' },
    ];

    for (const message of messages) {
      await handlers.handle(message);
    }
    await handlers.handle({ type: 'unknown' } as unknown as FromWebviewMessage);

    assert.equal(internals.launchHandlers.launch.mock.callCount(), 1);
    assert.equal(internals.profileHandlers.add.mock.callCount(), 1);
    assert.equal(internals.profileHandlers.edit.mock.callCount(), 1);
    assert.equal(internals.profileHandlers.delete.mock.callCount(), 1);
    assert.equal(internals.profileHandlers.showInExplorer.mock.callCount(), 1);
    assert.equal(internals.profileHandlers.exportProfiles.mock.callCount(), 1);
    assert.equal(internals.profileHandlers.importProfiles.mock.callCount(), 1);
    assert.equal(internals.suggestedProfileHandlers.request.mock.callCount(), 1);
    assert.equal(internals.efficiencyHandlers.toggle.mock.callCount(), 1);
    assert.equal(internals.storageHandlers.requestInfo.mock.callCount(), 1);
    assert.equal(internals.storageHandlers.clean.mock.callCount(), 1);
    assert.equal(internals.githubHandlers.configure.mock.callCount(), 1);
    assert.equal(internals.githubHandlers.clear.mock.callCount(), 1);
    assert.equal(internals.proxyHandlers.start.mock.callCount(), 1);
    assert.equal(internals.proxyHandlers.stop.mock.callCount(), 1);
    assert.equal(internals.proxyHandlers.showLogs.mock.callCount(), 1);
    assert.equal(internals.proxyHandlers.showTraffic.mock.callCount(), 1);
    assert.equal(internals.proxyHandlers.getInstallGuide.mock.callCount(), 1);
    assert.equal(internals.proxyHandlers.installCertificate.mock.callCount(), 1);
    assert.equal(internals.proxyHandlers.uninstallCertificate.mock.callCount(), 1);
    assert.equal(internals.proxyHandlers.saveCertificate.mock.callCount(), 1);
    assert.equal(internals.callbacks.refreshProxyStatus.mock.callCount(), 1);
    assert.deepEqual(
      internals.callbacks.refreshProxyStatus.mock.calls[0]?.arguments,
      [{ checkCertificate: true }]
    );
  });
});
