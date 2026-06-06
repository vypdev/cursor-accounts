import './registerVscodeMock';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as vscode from 'vscode';
import { initL10nForTests } from '../l10n';
import type { ProfileDetector } from '../profiles/profileDetector';
import type { ProfileLauncher } from '../profiles/profileLauncher';
import type { ProfileManager } from '../profiles/profileManager';
import type { ProfileWorkspaceService } from '../services/profileWorkspaceService';
import { AccountsPanelHandlers } from '../ui/accountsPanelHandlers';

const MESSAGES: Record<string, string> = {
  'panel.launched': 'Launched {name}',
  'panel.launchedWithProject': 'Launched {name} with project {project}',
  'panel.profileFallback': 'Profile',
  'errors.failedLaunchProfile': 'Failed to launch',
};

const CURRENT_PROFILE = {
  id: 'p1',
  email: 'user@example.com',
  slug: 'user',
  displayName: 'User',
  userDataDir: '/home/user/.cursor-user',
  created: '2024-01-01T00:00:00.000Z',
};

function createHandlers(deps: {
  profileDetector?: Partial<ProfileDetector>;
  profileLauncher?: Partial<ProfileLauncher>;
  profileWorkspaceService?: Partial<ProfileWorkspaceService>;
  onExecuteCommand?: (...args: unknown[]) => Promise<unknown>;
}) {
  let refreshCalled = false;
  let executeCommandImpl = deps.onExecuteCommand;

  const handlers = new AccountsPanelHandlers(
    {
      profileManager: {
        getProfile: async () => CURRENT_PROFILE,
      } as unknown as ProfileManager,
      profileLauncher: {
        launch: async () => ({ success: true, pid: 1 }),
        ...deps.profileLauncher,
      } as ProfileLauncher,
      profileDetector: {
        detectCurrentProfile: async () => CURRENT_PROFILE,
        ...deps.profileDetector,
      } as ProfileDetector,
      efficiencyService: {} as never,
      authReader: {} as never,
      instanceDetector: {} as never,
      storageCleanupService: {} as never,
      storageAnalyzer: {
        calculateProfileStorageSize: async () => ({
          profileId: 'p1',
          databaseBytes: 0,
          walBytes: 0,
          workspaceStorageBytes: 0,
          editorCacheBytes: 0,
          extensionCacheBytes: 0,
          efficiencyDbBytes: 0,
          totalBytes: 0,
        }),
        getProfileTotalBytes: async () => 0,
      },
      profileWorkspaceService: {
        getMostRecentWorkspace: async () => undefined,
        ...deps.profileWorkspaceService,
      } as ProfileWorkspaceService,
      proxyManager: {
        start: async () => ({ success: true, port: 8080 }),
        stop: async () => undefined,
        restartProfileProxy: async () => ({ success: true, port: 8080 }),
        getStatus: async () => ({ running: false }),
        isRunning: async () => false,
        isCurrentWindowUsingProxy: async () => false,
        getCertificatePath: async () => null,
        getLogDirectory: () => '/tmp',
        getProxyInstallGuide: async () => ({
          platform: 'darwin',
          certAvailable: false,
          title: 'Install',
          intro: 'Intro',
          steps: [],
        }),
        installCertificate: async () => ({ success: true }),
        uninstallCertificate: async () => ({ success: true }),
        checkCertificateInstalled: async () => false,
        getCachedCertificateInstalled: () => undefined,
        getProxyServerUrl: async () => null,
        getAllUsedPorts: async () => [],
        ensureProfileProxy: async () => ({ success: true, port: 8080 }),
        restoreAllProfileProxySettings: async () => ({ restored: 0, errors: [] }),
        onStatusChange: () => undefined,
        ensureOutputTailer: async () => undefined,
        ensureTrafficTailer: async () => undefined,
        showOutputChannel: () => undefined,
        showTokenDetectorChannel: () => undefined,
      },
    },
    {
      postMessage: async () => undefined,
      refresh: async () => {
        refreshCalled = true;
      },
      refreshInstances: async () => undefined,
      refreshGithubSummaries: async () => undefined,
      refreshProxyStatus: async () => undefined,
      hasActiveWebview: () => true,
    }
  );

  if (executeCommandImpl) {
    (vscode.commands as unknown as {
      executeCommand: (...args: unknown[]) => Promise<unknown>;
    }).executeCommand = (...args: unknown[]) => executeCommandImpl!(...args);
  }

  return {
    handlers,
    wasRefreshed: () => refreshCalled,
  };
}

describe('AccountsPanelHandlers launch', () => {
  beforeEach(() => {
    initL10nForTests(MESSAGES);
    (vscode.workspace as { workspaceFolders?: unknown[] }).workspaceFolders = [
      { uri: { fsPath: '/Users/dev/open-project' } },
    ];
    (vscode.workspace as { workspaceFile?: unknown }).workspaceFile = undefined;
  });

  it('no-ops when opening an already-open project for the current profile', async () => {
    let executeCalled = false;
    let launchCalled = false;

    const { handlers } = createHandlers({
      onExecuteCommand: async () => {
        executeCalled = true;
      },
      profileLauncher: {
        launch: async () => {
          launchCalled = true;
          return { success: true };
        },
      },
    });

    await handlers.handle({
      type: 'launch',
      profileId: 'p1',
      projectPath: '/Users/dev/open-project',
    });

    assert.equal(executeCalled, false);
    assert.equal(launchCalled, false);
  });

  it('opens folder in current window for current profile when project is not open', async () => {
    let executeArgs: unknown[] | undefined;
    let launchCalled = false;

    const { handlers, wasRefreshed } = createHandlers({
      onExecuteCommand: async (...args: unknown[]) => {
        executeArgs = args;
      },
      profileLauncher: {
        launch: async () => {
          launchCalled = true;
          return { success: true };
        },
      },
    });

    await handlers.handle({
      type: 'launch',
      profileId: 'p1',
      projectPath: '/Users/dev/other-project',
    });

    assert.equal(executeArgs?.[0], 'vscode.openFolder');
    assert.equal(launchCalled, false);
    assert.equal(wasRefreshed(), true);
  });

  it('uses ProfileLauncher for other profiles when current profile is undetected', async () => {
    let launchCalled = false;

    const { handlers } = createHandlers({
      profileDetector: {
        detectCurrentProfile: async () => null,
      },
      profileLauncher: {
        launch: async () => {
          launchCalled = true;
          return { success: true, pid: 42 };
        },
      },
    });

    await handlers.handle({
      type: 'launch',
      profileId: 'p1',
      projectPath: '/Users/dev/other-project',
    });

    assert.equal(launchCalled, true);
  });

  it('opens folder in current window for same profile with no open workspace', async () => {
    (vscode.workspace as { workspaceFolders?: unknown[] }).workspaceFolders = [];
    let executeCalled = false;
    let launchCalled = false;

    const { handlers } = createHandlers({
      onExecuteCommand: async () => {
        executeCalled = true;
      },
      profileLauncher: {
        launch: async () => {
          launchCalled = true;
          return { success: true };
        },
      },
    });

    await handlers.handle({
      type: 'launch',
      profileId: 'p1',
      projectPath: '/Users/dev/other-project',
    });

    assert.equal(executeCalled, true);
    assert.equal(launchCalled, false);
  });

  it('opens folder in current window when same profile has another project open', async () => {
    let executeArgs: unknown[] | undefined;
    let launchCalled = false;

    const { handlers } = createHandlers({
      onExecuteCommand: async (...args: unknown[]) => {
        executeArgs = args;
      },
      profileLauncher: {
        launch: async () => {
          launchCalled = true;
          return { success: true };
        },
      },
    });

    await handlers.handle({
      type: 'launch',
      profileId: 'p1',
      projectPath: '/Users/dev/other-project',
    });

    assert.equal(executeArgs?.[0], 'vscode.openFolder');
    assert.equal(launchCalled, false);
  });

  it('uses ProfileLauncher for different profile with empty current workspace', async () => {
    (vscode.workspace as { workspaceFolders?: unknown[] }).workspaceFolders = [];
    let executeCalled = false;
    let launchCalled = false;

    const { handlers } = createHandlers({
      onExecuteCommand: async () => {
        executeCalled = true;
      },
      profileLauncher: {
        launch: async () => {
          launchCalled = true;
          return { success: true, pid: 99 };
        },
      },
    });

    await handlers.handle({
      type: 'launch',
      profileId: 'p2',
      projectPath: '/Users/dev/work-project',
    });

    assert.equal(executeCalled, false);
    assert.equal(launchCalled, true);
  });

  it('uses ProfileLauncher for different profile when current has a workspace open', async () => {
    let executeCalled = false;
    let launchCalled = false;

    const { handlers } = createHandlers({
      onExecuteCommand: async () => {
        executeCalled = true;
      },
      profileLauncher: {
        launch: async () => {
          launchCalled = true;
          return { success: true, pid: 99 };
        },
      },
    });

    await handlers.handle({
      type: 'launch',
      profileId: 'p2',
      projectPath: '/Users/dev/work-project',
    });

    assert.equal(executeCalled, false);
    assert.equal(launchCalled, true);
  });
});
