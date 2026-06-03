import './registerVscodeMock';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { InstanceDetector } from '../profiles/instanceDetector';
import { ProfileDetector } from '../profiles/profileDetector';
import { ProfileLauncher } from '../profiles/profileLauncher';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileStorage } from '../profiles/profileStorage';
import type { FromWebviewMessage, ToWebviewMessage } from '../profiles/types';
import type { MultiProfileQuotaService } from '../services/multiProfileQuotaService';
import type { ProfileAccountFetcher } from '../services/profileAccountFetcher';
import type { ProfileWorkspaceService } from '../services/profileWorkspaceService';
import type { EfficiencyService } from '../modelEfficiency/efficiencyService';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import type { IProfileStorageAnalyzer } from '../domain/ports/IProfileStorageAnalyzer';
import type { IStorageCleanupService } from '../domain/ports/IStorageCleanupService';
import type { IProxyManager } from '../domain/ports/IProxyManager';
import { AccountsPanelProvider } from '../ui/accountsPanel';
import { first } from './testUtils';

interface MockWebview {
  options: { enableScripts?: boolean; localResourceRoots?: unknown[] };
  html: string;
  cspSource: string;
  postedMessages: ToWebviewMessage[];
  postMessage(message: ToWebviewMessage): Promise<boolean>;
  asWebviewUri(uri: { fsPath: string }): { toString: () => string };
  onDidReceiveMessage: (
    callback: (message: FromWebviewMessage) => void
  ) => { dispose: () => void };
}

interface MockWebviewPanel {
  webview: MockWebview;
  reveal: () => void;
  onDidDispose: (callback: () => void) => { dispose: () => void };
}

interface MockExtensionContext {
  extensionPath: string;
  subscriptions: { dispose: () => void }[];
  globalStorageUri: { fsPath: string };
  globalState: {
    get: () => undefined;
    update: () => Promise<void>;
  };
}

function createMockInstanceDetector(): InstanceDetector {
  return {
    detectRunningInstances: async () => new Map(),
    isProfileRunning: async () => false,
    getLastDetection: () => new Map(),
    startAutoDetection: () => undefined,
    stopAutoDetection: () => undefined,
    onDetectionChange: () => undefined,
  } as unknown as InstanceDetector;
}

function createMockAccountFetcher(): ProfileAccountFetcher {
  return {
    fetchAllProfileAccounts: async () => new Map(),
    fetchActiveWindowAccount: async () => null,
  } as unknown as ProfileAccountFetcher;
}

function createMockQuotaService(): MultiProfileQuotaService {
  return {
    fetchAllQuotas: async () => new Map(),
    getAllCachedQuotas: () => new Map(),
    onRefresh: () => undefined,
  } as unknown as MultiProfileQuotaService;
}

function createMockAuthReader(): IProfileAuthReader {
  return {
    readTokens: async () => null,
  };
}

function createMockProfileWorkspaceService(): ProfileWorkspaceService {
  return {
    getProfilesWithWorkspaces: async () => [],
    getWorkspacesForProfile: async () => [],
    getMostRecentWorkspace: async () => undefined,
  } as unknown as ProfileWorkspaceService;
}

function createMockProxyManager(): IProxyManager {
  return {
    start: async () => ({ success: true, port: 8080 }),
    stop: async () => undefined,
    getStatus: async () => ({ running: false, logDirectory: '/tmp/proxy-logs' }),
    isRunning: async () => false,
    isCurrentWindowUsingProxy: async () => false,
    getCertificatePath: async () => null,
    getLogDirectory: () => '/tmp/proxy-logs',
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
    getOutputPresenter: () => undefined,
    ensureOutputTailer: async () => undefined,
    showOutputChannel: () => undefined,
  };
}

function createMockEfficiencyService(): EfficiencyService {
  return {
    setEfficiencyEnabled: async () => ({
      profile: { id: 'p1', email: 'a@b.com' } as never,
      message: 'ok',
    }),
    getStatsStorage: () => ({
      getAllStats: () => ({}),
    }),
  } as unknown as EfficiencyService;
}

function createMockStorageAnalyzer(): IProfileStorageAnalyzer {
  return {
    calculateProfileStorageSize: async (profileId) => ({
      profileId,
      databaseBytes: 0,
      walBytes: 0,
      workspaceStorageBytes: 0,
      editorCacheBytes: 0,
      extensionCacheBytes: 0,
      efficiencyDbBytes: 0,
      totalBytes: 0,
    }),
    getProfileTotalBytes: async () => 0,
  };
}

function createMockStorageCleanupService(): IStorageCleanupService {
  return {
    cleanProfileStorage: async () => ({
      success: true,
      bytesReclaimed: 0,
      message: 'ok',
    }),
  };
}

function createMockWebview(): MockWebview {
  let messageHandler: ((message: FromWebviewMessage) => void) | undefined;

  const webview: MockWebview = {
    options: {},
    html: '',
    cspSource: 'https://webview.vscode-cdn.net',
    postedMessages: [],
    asWebviewUri(uri) {
      return {
        toString: () =>
          `https://webview.local/${encodeURIComponent(uri.fsPath)}`,
      };
    },
    async postMessage(message: ToWebviewMessage): Promise<boolean> {
      webview.postedMessages.push(message);
      return true;
    },
    onDidReceiveMessage(callback) {
      messageHandler = callback;
      return {
        dispose: () => {
          messageHandler = undefined;
        },
      };
    },
  };

  (webview as MockWebview & { _emit: (m: FromWebviewMessage) => void })._emit =
    (message: FromWebviewMessage) => {
      if (messageHandler) {
        messageHandler(message);
      }
    };

  return webview;
}

function createMockContext(extensionPath: string): MockExtensionContext {
  return {
    extensionPath,
    subscriptions: [],
    globalStorageUri: {
      fsPath: path.join(extensionPath, 'User', 'globalStorage', 'ext'),
    },
    globalState: {
      get: () => undefined,
      update: async () => undefined,
    },
  };
}

describe('AccountsPanelProvider', () => {
  let tempDir: string;
  let configDir: string;
  let extensionPath: string;
  let manager: ProfileManager;
  let launcher: ProfileLauncher;
  let detector: ProfileDetector;
  let quotaService: MultiProfileQuotaService;
  let accountFetcher: ProfileAccountFetcher;
  let instanceDetector: InstanceDetector;
  let provider: AccountsPanelProvider;
  let mockWebview: MockWebview;
  let mockPanel: MockWebviewPanel;
  let revealCalled: boolean;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-accounts-panel-')
    );
    configDir = path.join(tempDir, 'config');
    extensionPath = path.join(tempDir, 'extension');
    const webviewDist = path.join(extensionPath, 'webview-dist');
    await fs.mkdir(webviewDist, { recursive: true });
    await fs.writeFile(path.join(webviewDist, 'bundle.js'), '// mock');
    await fs.writeFile(path.join(webviewDist, 'bundle.css'), '/* mock */');

    const storage = new ProfileStorage(configDir);
    manager = new ProfileManager(storage);
    await manager.initialize();
    launcher = new ProfileLauncher(manager);

    detector = new ProfileDetector(
      manager,
      createMockContext(extensionPath) as never
    );

    quotaService = createMockQuotaService();
    accountFetcher = createMockAccountFetcher();
    instanceDetector = createMockInstanceDetector();

    provider = new AccountsPanelProvider(
      createMockContext(extensionPath) as never,
      manager,
      launcher,
      detector,
      quotaService,
      accountFetcher,
      instanceDetector,
      createMockProfileWorkspaceService(),
      createMockEfficiencyService(),
      createMockAuthReader(),
      createMockStorageCleanupService(),
      createMockStorageAnalyzer(),
      createMockProxyManager()
    );

    mockWebview = createMockWebview();
    revealCalled = false;
    mockPanel = {
      webview: mockWebview,
      reveal: () => {
        revealCalled = true;
      },
      onDidDispose: () => ({ dispose: () => undefined }),
    };

    (vscode.window as never as { createWebviewPanel: () => MockWebviewPanel }).createWebviewPanel =
      () => mockPanel;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function openPanel(): void {
    provider.openPanel();
  }

  async function emitMessage(message: FromWebviewMessage): Promise<void> {
    const emitter = mockWebview as MockWebview & {
      _emit?: (m: FromWebviewMessage) => void;
    };
    emitter._emit?.(message);
    const waitMs = message.type === 'ready' ? 200 : 10;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  it('opens editor panel and sets html with CSP and bundle references', () => {
    openPanel();

    assert.equal(provider.hasResolvedView(), true);
    assert.ok(mockWebview.html.includes('Content-Security-Policy'));
    assert.ok(
      mockWebview.html.includes(`script-src ${mockWebview.cspSource}`)
    );
    assert.ok(mockWebview.html.includes('bundle.js'));
    assert.ok(mockWebview.html.includes('bundle.css'));
    assert.ok(mockWebview.html.includes('id="root"'));
    assert.ok(mockWebview.html.includes('Loading Cursor Accounts'));
    assert.ok(mockWebview.html.includes('img-src'));
    assert.ok(mockWebview.html.includes('https:'));
    assert.ok(mockWebview.html.includes('acquireVsCodeApi'));
    assert.ok(mockWebview.html.includes('waitForServiceWorker'));
    assert.ok(mockWebview.html.includes("postMessage({ type: 'ready' })"));
    assert.ok(mockWebview.html.includes('reportLog'));
    assert.ok(mockWebview.html.includes("'webviewLog'"));
    assert.ok(
      mockWebview.html.indexOf('acquireVsCodeApi') <
        mockWebview.html.indexOf('bundle.js')
    );
    assert.ok(
      mockWebview.html.indexOf('waitForServiceWorker') <
        mockWebview.html.indexOf('bundle.js')
    );
  });

  it('reveals existing panel instead of creating a new one', () => {
    openPanel();
    revealCalled = false;

    provider.openPanel();

    assert.equal(revealCalled, true);
  });

  it('reveal brings panel to foreground', () => {
    openPanel();
    revealCalled = false;

    provider.reveal();

    assert.equal(revealCalled, true);
  });

  it('handles webviewLog messages from the webview', async () => {
    openPanel();

    await emitMessage({
      type: 'webviewLog',
      level: 'info',
      phase: 'bootstrap.ready-sent',
      message: 'test log message',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('sends init when ready is received', async () => {
    openPanel();
    mockWebview.postedMessages = [];

    await emitMessage({ type: 'ready' });

    const initMessage = mockWebview.postedMessages.find((m) => m.type === 'init');
    assert.ok(initMessage);
  });

  it('sends init message on ready with empty profiles', async () => {
    openPanel();
    await emitMessage({ type: 'ready' });

    const initMessage = mockWebview.postedMessages.find((m) => m.type === 'init');
    assert.ok(initMessage);
    if (initMessage?.type === 'init') {
      assert.deepEqual(initMessage.data.profiles, []);
      assert.equal(initMessage.data.currentProfile, null);
      assert.deepEqual(initMessage.data.quotas, {});
      assert.deepEqual(initMessage.data.profileAccounts, {});
      assert.equal(initMessage.data.activeAccount, null);
      assert.deepEqual(initMessage.data.runningInstances, {});
    }
  });

  it('does not send init on open without ready', async () => {
    openPanel();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const initMessage = mockWebview.postedMessages.find((m) => m.type === 'init');
    assert.equal(initMessage, undefined);
  });

  it('sends init message on requestInit', async () => {
    openPanel();
    mockWebview.postedMessages = [];

    await emitMessage({ type: 'requestInit' });

    const initMessage = mockWebview.postedMessages.find((m) => m.type === 'init');
    assert.ok(initMessage);
    if (initMessage?.type === 'init') {
      assert.deepEqual(initMessage.data.profiles, []);
    }
  });

  it('sends init message with profiles after refresh', async () => {
    await manager.createProfile({
      email: 'user@example.com',
      displayName: 'Work',
    });

    openPanel();
    await emitMessage({ type: 'refresh' });

    const initMessage = mockWebview.postedMessages.find((m) => m.type === 'init');
    assert.ok(initMessage);
    if (initMessage?.type === 'init') {
      assert.equal(initMessage.data.profiles.length, 1);
      assert.equal(first(initMessage.data.profiles).displayName, 'Work');
    }
  });

  it('handles add message and refreshes list', async () => {
    openPanel();

    await emitMessage({
      type: 'add',
      email: 'new@example.com',
      displayName: 'New Profile',
      color: '#ff0000',
    });

    const success = mockWebview.postedMessages.find((m) => m.type === 'success');
    assert.ok(success);
    if (success?.type === 'success') {
      assert.ok(success.message.includes('New Profile'));
    }

    const init = mockWebview.postedMessages.filter((m) => m.type === 'init');
    assert.ok(init.length >= 1);
    const lastInit = init[init.length - 1];
    if (lastInit?.type === 'init') {
      assert.equal(lastInit.data.profiles.length, 1);
      assert.equal(first(lastInit.data.profiles).email, 'new@example.com');
    }
  });

  it('responds to requestSuggestedProfile when no auth is available', async () => {
    openPanel();
    mockWebview.postedMessages = [];

    await emitMessage({ type: 'requestSuggestedProfile' });

    const suggested = mockWebview.postedMessages.find(
      (m) => m.type === 'suggestedProfile'
    );
    assert.ok(suggested);
    if (suggested?.type === 'suggestedProfile') {
      assert.equal(suggested.email, undefined);
      assert.equal(suggested.displayName, undefined);
    }
  });

  it('handles edit message', async () => {
    const profile = await manager.createProfile({
      email: 'edit@example.com',
      displayName: 'Before',
    });

    openPanel();
    mockWebview.postedMessages = [];

    await emitMessage({
      type: 'edit',
      profileId: profile.id,
      updates: { displayName: 'After' },
    });

    const success = mockWebview.postedMessages.find((m) => m.type === 'success');
    assert.ok(success);

    const updated = await manager.getProfile(profile.id);
    assert.equal(updated?.displayName, 'After');
  });

  it('handles delete message', async () => {
    const profile = await manager.createProfile({
      email: 'delete@example.com',
    });

    openPanel();
    mockWebview.postedMessages = [];

    await emitMessage({ type: 'delete', profileId: profile.id });

    const success = mockWebview.postedMessages.find((m) => m.type === 'success');
    assert.ok(success);

    const profiles = await manager.getProfiles();
    assert.equal(profiles.length, 0);
  });

  it('posts error when showInExplorer profile not found', async () => {
    openPanel();
    mockWebview.postedMessages = [];

    await emitMessage({
      type: 'showInExplorer',
      profileId: 'non-existent-id',
    });

    const errorMsg = mockWebview.postedMessages.find((m) => m.type === 'error');
    assert.ok(errorMsg);
    if (errorMsg?.type === 'error') {
      assert.ok(errorMsg.message.includes('not found'));
    }
  });

  it('posts error when launch fails', async () => {
    const profile = await manager.createProfile({
      email: 'launch@example.com',
    });

    const failingLauncher = {
      launch: async () => ({
        success: false,
        error: 'Launch failed for test',
      }),
    } as unknown as ProfileLauncher;

    const failingProvider = new AccountsPanelProvider(
      createMockContext(extensionPath) as never,
      manager,
      failingLauncher,
      detector,
      quotaService,
      accountFetcher,
      instanceDetector,
      createMockProfileWorkspaceService(),
      createMockEfficiencyService(),
      createMockAuthReader(),
      createMockStorageCleanupService(),
      createMockStorageAnalyzer(),
      createMockProxyManager()
    );

    failingProvider.openPanel();
    mockWebview.postedMessages = [];

    await emitMessage({ type: 'launch', profileId: profile.id });

    const errorMsg = mockWebview.postedMessages.find((m) => m.type === 'error');
    assert.ok(errorMsg);
    if (errorMsg?.type === 'error') {
      assert.equal(errorMsg.message, 'Launch failed for test');
    }
  });

  it('refresh does nothing when panel is not open', async () => {
    await provider.refresh();
    assert.equal(mockWebview.postedMessages.length, 0);
  });

  it('public refresh sends init data when panel is open', async () => {
    await manager.createProfile({ email: 'refresh@example.com' });
    openPanel();
    mockWebview.postedMessages = [];

    await provider.refresh();

    const initMessage = mockWebview.postedMessages.find((m) => m.type === 'init');
    assert.ok(initMessage);
    if (initMessage?.type === 'init') {
      assert.equal(initMessage.data.profiles.length, 1);
      assert.ok(initMessage.data.profileWorkspaces);
      assert.ok(Array.isArray(initMessage.data.openWorkspacePaths));
    }
  });
});
