import './registerVscodeMock';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { InstanceDetector } from '../profiles/instanceDetector';
import { ProfileDetector } from '../profiles/profileDetector';
import { ProfileLauncher } from '../profiles/profileLauncher';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileStorage } from '../profiles/profileStorage';
import { FromWebviewMessage, ToWebviewMessage } from '../profiles/types';
import { MultiProfileQuotaService } from '../services/multiProfileQuotaService';
import { ProfileAccountFetcher } from '../services/profileAccountFetcher';
import { AccountsPanelProvider } from '../ui/accountsPanel';

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

interface MockWebviewView {
  webview: MockWebview;
  visible: boolean;
  onDidChangeVisibility: (callback: () => void) => { dispose: () => void };
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
    getAllCachedQuotas: async () => new Map(),
    onRefresh: () => undefined,
  } as unknown as MultiProfileQuotaService;
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
  let mockView: MockWebviewView;
  let mockWebview: MockWebview;

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
      instanceDetector
    );

    mockWebview = createMockWebview();
    mockView = {
      webview: mockWebview,
      visible: true,
      onDidChangeVisibility: () => ({ dispose: () => undefined }),
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function resolvePanel(): void {
    provider.resolveWebviewView(mockView as never, {} as never, {} as never);
  }

  async function emitMessage(message: FromWebviewMessage): Promise<void> {
    const emitter = mockWebview as MockWebview & {
      _emit?: (m: FromWebviewMessage) => void;
    };
    emitter._emit?.(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  it('configures webview with scripts and localResourceRoots', () => {
    resolvePanel();

    assert.equal(mockWebview.options.enableScripts, true);
    assert.ok(mockWebview.options.localResourceRoots);
    assert.equal(
      (mockWebview.options.localResourceRoots as { fsPath?: string }[]).length,
      1
    );
  });

  it('generates HTML with CSP and bundle references', () => {
    resolvePanel();

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
  });

  it('sends init message on ready with empty profiles', async () => {
    resolvePanel();
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

  it('sends init message with profiles after refresh', async () => {
    await manager.createProfile({
      email: 'user@example.com',
      displayName: 'Work',
    });

    resolvePanel();
    await emitMessage({ type: 'refresh' });

    const initMessage = mockWebview.postedMessages.find((m) => m.type === 'init');
    assert.ok(initMessage);
    if (initMessage?.type === 'init') {
      assert.equal(initMessage.data.profiles.length, 1);
      assert.equal(initMessage.data.profiles[0].displayName, 'Work');
    }
  });

  it('handles add message and refreshes list', async () => {
    resolvePanel();

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
      assert.equal(lastInit.data.profiles[0].email, 'new@example.com');
    }
  });

  it('responds to requestSuggestedProfile when no auth is available', async () => {
    resolvePanel();
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

    resolvePanel();
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

    resolvePanel();
    mockWebview.postedMessages = [];

    await emitMessage({ type: 'delete', profileId: profile.id });

    const success = mockWebview.postedMessages.find((m) => m.type === 'success');
    assert.ok(success);

    const profiles = await manager.getProfiles();
    assert.equal(profiles.length, 0);
  });

  it('posts error when showInExplorer profile not found', async () => {
    resolvePanel();
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
      instanceDetector
    );

    failingProvider.resolveWebviewView(
      mockView as never,
      {} as never,
      {} as never
    );
    mockWebview.postedMessages = [];

    await emitMessage({ type: 'launch', profileId: profile.id });

    const errorMsg = mockWebview.postedMessages.find((m) => m.type === 'error');
    assert.ok(errorMsg);
    if (errorMsg?.type === 'error') {
      assert.equal(errorMsg.message, 'Launch failed for test');
    }
  });

  it('refresh does nothing when view is not resolved', async () => {
    await provider.refresh();
    assert.equal(mockWebview.postedMessages.length, 0);
  });

  it('public refresh sends init data when view is resolved', async () => {
    await manager.createProfile({ email: 'refresh@example.com' });
    resolvePanel();
    mockWebview.postedMessages = [];

    await provider.refresh();

    const initMessage = mockWebview.postedMessages.find((m) => m.type === 'init');
    assert.ok(initMessage);
    if (initMessage?.type === 'init') {
      assert.equal(initMessage.data.profiles.length, 1);
    }
  });
});
