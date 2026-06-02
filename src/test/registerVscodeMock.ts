/**
 * Registers a minimal vscode module mock for Node unit tests.
 * Must be imported before any extension module that requires 'vscode'.
 */
import Module from 'node:module';
import * as path from 'path';
import { initL10n } from '../l10n';

const repoRoot = path.join(__dirname, '..', '..');
initL10n({ extensionPath: repoRoot, language: 'en' });

function createLogOutputChannelStub() {
  return {
    appendLine: () => undefined,
    append: () => undefined,
    replace: () => undefined,
    clear: () => undefined,
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
    name: 'Cursor Accounts',
    logLevel: 0,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

const vscodeMock = {
  Uri: {
    file: (filePath: string) => ({
      fsPath: filePath,
      toString: () => filePath,
    }),
  },
  env: {
    language: 'en',
  },
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },
  window: {
    createStatusBarItem: () => ({
      text: '',
      tooltip: '',
      command: '',
      name: '',
      show: () => undefined,
      hide: () => undefined,
      dispose: () => undefined,
    }),
    registerWebviewViewProvider: () => ({ dispose: () => undefined }),
    createWebviewPanel: () => ({
      webview: {
        html: '',
        cspSource: 'https://webview.vscode-cdn.net',
        options: {},
        postedMessages: [] as unknown[],
        asWebviewUri(uri: { fsPath: string }) {
          return { toString: () => `https://webview.local/${uri.fsPath}` };
        },
        postMessage: async () => true,
        onDidReceiveMessage: () => ({ dispose: () => undefined }),
      },
      reveal: () => undefined,
      onDidDispose: () => ({ dispose: () => undefined }),
    }),
    createOutputChannel: (
      _name: string,
      options?: { log?: boolean }
    ) => {
      if (options?.log) {
        return createLogOutputChannelStub();
      }
      return createLogOutputChannelStub();
    },
  },
  commands: {
    executeCommand: async () => undefined,
    registerCommand: () => ({ dispose: () => undefined }),
  },
  workspace: {
    workspaceFolders: [] as Array<{ uri: { fsPath: string } }>,
    workspaceFile: undefined as { fsPath: string } | undefined,
    getConfiguration: (section?: string) => ({
      inspect: () => undefined,
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        if (section === 'cursorAccounts.profiles') {
          const profileDefaults: Record<string, unknown> = {
            refreshAllInterval: 300,
            autoDetectRunning: false,
            instanceDetectionInterval: 30,
          };
          if (key in profileDefaults) {
            return profileDefaults[key] as T;
          }
        }
        if (section === 'cursorAccounts.refresh') {
          const refreshDefaults: Record<string, unknown> = {
            enabled: false,
            intervalSeconds: 60,
          };
          if (key in refreshDefaults) {
            return refreshDefaults[key] as T;
          }
        }
        return defaultValue;
      },
      update: async () => undefined,
    }),
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    onDidChangeWorkspaceFolders: () => ({ dispose: () => undefined }),
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
  },
  ViewColumn: {
    Active: -1,
    Beside: -2,
    One: 1,
    Two: 2,
    Three: 3,
    Four: 4,
    Five: 5,
    Six: 6,
    Seven: 7,
    Eight: 8,
    Nine: 9,
  },
};

type LoadFn = (
  request: string,
  parent: unknown,
  isMain: boolean
) => unknown;

const moduleRuntime = Module as unknown as {
  _load: LoadFn;
};

const originalLoad = moduleRuntime._load;

moduleRuntime._load = function (
  request: string,
  parent: unknown,
  isMain: boolean
): unknown {
  if (request === 'vscode') {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};
