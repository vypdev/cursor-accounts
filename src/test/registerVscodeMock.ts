/**
 * Registers a minimal vscode module mock for Node unit tests.
 * Must be imported before any extension module that requires 'vscode'.
 */
import Module from 'node:module';

const vscodeMock = {
  Uri: {
    file: (filePath: string) => ({
      fsPath: filePath,
      toString: () => filePath,
    }),
  },
  window: {
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
    createOutputChannel: () => ({
      appendLine: () => undefined,
      append: () => undefined,
      replace: () => undefined,
      clear: () => undefined,
      show: () => undefined,
      hide: () => undefined,
      dispose: () => undefined,
      name: 'Cursor Quota',
    }),
  },
  commands: {
    executeCommand: async () => undefined,
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
