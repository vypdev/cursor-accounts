import './registerVscodeMock';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as vscode from 'vscode';
import { initL10nForTests } from '../l10n';
import { registerProxyCommands } from '../commands/proxyCommands';

const registeredHandlers = new Map<string, () => Promise<void> | void>();
const MESSAGES: Record<string, string> = {
  'commands.proxy.requiresProfile': 'A managed profile is required',
  'commands.proxy.started': 'Proxy started on port {port}',
  'commands.proxy.startFailed': 'Proxy failed: {error}',
  'commands.proxy.stopped': 'Proxy stopped',
  'commands.proxy.logsDeleteConfirm': 'Delete logs?',
  'commands.proxy.logsDeleteConfirmAction': 'Delete',
  'commands.proxy.logsDeleted': 'Deleted {count} log files',
  'commands.proxy.logsDeleteFailed': 'Delete failed: {error}',
  'commands.proxy.saveCertificate.failed': 'Certificate failed: {error}',
  'commands.proxy.saveCertificate.notFound': 'Certificate not found',
};

type WindowMessages = {
  showInformationMessage: (message: string) => unknown;
  showWarningMessage: (
    message: string,
    options?: unknown,
    action?: string
  ) => Promise<string | undefined>;
  showErrorMessage: (message: string) => unknown;
};

function windowMessages(): WindowMessages {
  return vscode.window as unknown as WindowMessages;
}

function createProfile(proxyEnabled?: boolean) {
  return {
    id: 'profile-1',
    email: 'profile@example.com',
    slug: 'profile-1',
    displayName: 'Profile 1',
    userDataDir: '/tmp/profile-1',
    created: '2026-01-01T00:00:00.000Z',
    proxyEnabled,
  };
}

function createDependencies(overrides: {
  profile?: ReturnType<typeof createProfile> | null;
  start?: () => Promise<{ success: boolean; port?: number; error?: string }>;
  stop?: (profileId: string) => Promise<void>;
  clearLogFiles?: () => Promise<{ deletedFiles: number; deletedBytes: number }>;
  getCertificatePath?: () => Promise<string | null>;
} = {}) {
  const calls = {
    starts: 0,
    stops: [] as string[],
    clears: 0,
    outputTailers: 0,
    tokenChannels: 0,
  };
  const proxyManager = {
    onStatusChange: (callback: () => void) => {
      callback();
    },
    start: async () => {
      calls.starts += 1;
      return overrides.start
        ? await overrides.start()
        : { success: true, port: 8080 };
    },
    stop: async (profileId: string) => {
      calls.stops.push(profileId);
      await overrides.stop?.(profileId);
    },
    getLogDirectory: () => '/tmp/proxy-logs',
    clearLogFiles: async () => {
      calls.clears += 1;
      return overrides.clearLogFiles
        ? await overrides.clearLogFiles()
        : { deletedFiles: 2, deletedBytes: 10 };
    },
    ensureOutputTailer: async () => {
      calls.outputTailers += 1;
    },
    showOutputChannel: () => undefined,
    showTokenDetectorChannel: () => {
      calls.tokenChannels += 1;
    },
    getCertificatePath: async () =>
      overrides.getCertificatePath
        ? await overrides.getCertificatePath()
        : null,
  };
  const profileDetector = {
    detectCurrentProfile: async () =>
      overrides.profile !== undefined ? overrides.profile : createProfile(),
  };
  return { calls, proxyManager, profileDetector };
}

function register(overrides: Parameters<typeof createDependencies>[0] = {}) {
  const dependencies = createDependencies(overrides);
  const context = { subscriptions: [] as { dispose: () => void }[] };
  registerProxyCommands(
    context as never,
    dependencies.proxyManager as never,
    dependencies.profileDetector as never,
    () => undefined
  );
  return dependencies;
}

beforeEach(() => {
  initL10nForTests(MESSAGES);
  registeredHandlers.clear();
  (vscode.commands as unknown as {
    registerCommand: (
      command: string,
      handler: () => Promise<void> | void
    ) => { dispose: () => void };
  }).registerCommand = (command, handler) => {
    registeredHandlers.set(command, handler);
    return { dispose: () => registeredHandlers.delete(command) };
  };
  const messages = windowMessages();
  messages.showInformationMessage = () => undefined;
  messages.showErrorMessage = () => undefined;
  messages.showWarningMessage = async () => undefined;
});

describe('registerProxyCommands', () => {
  it('registers every proxy command and forwards status changes', () => {
    const dependencies = register();
    assert.equal(registeredHandlers.size, 7);
    assert.equal(dependencies.calls.starts, 0);
    for (const command of [
      'cursorAccounts.proxy.start',
      'cursorAccounts.proxy.stop',
      'cursorAccounts.proxy.showLogs',
      'cursorAccounts.proxy.clearLogs',
      'cursorAccounts.proxy.showOutput',
      'cursorAccounts.proxy.showTokenDetector',
      'cursorAccounts.proxy.saveCertificate',
    ]) {
      assert.ok(registeredHandlers.has(command), `missing ${command}`);
    }
  });

  it('starts the enabled current profile and reports success', async () => {
    const messages: string[] = [];
    windowMessages().showInformationMessage = (message) => messages.push(message);
    const dependencies = register();

    await registeredHandlers.get('cursorAccounts.proxy.start')!();

    assert.equal(dependencies.calls.starts, 1);
    assert.ok(messages.some((message) => message.includes('8080')));
  });

  it('reports start failures and does not require callers to catch them', async () => {
    const messages: string[] = [];
    windowMessages().showErrorMessage = (message) => messages.push(message);
    const dependencies = register({
      start: async () => ({ success: false, error: 'port busy' }),
    });

    await registeredHandlers.get('cursorAccounts.proxy.start')!();

    assert.equal(dependencies.calls.starts, 1);
    assert.ok(messages.some((message) => message.includes('port busy')));
  });

  it('blocks start and stop when no enabled profile is detected', async () => {
    const dependencies = register({ profile: null });

    await registeredHandlers.get('cursorAccounts.proxy.start')!();
    await registeredHandlers.get('cursorAccounts.proxy.stop')!();

    assert.equal(dependencies.calls.starts, 0);
    assert.deepEqual(dependencies.calls.stops, []);
  });

  it('stops the current profile and shows output with configured tailing', async () => {
    const dependencies = register();

    await registeredHandlers.get('cursorAccounts.proxy.stop')!();
    await registeredHandlers.get('cursorAccounts.proxy.showOutput')!();

    assert.deepEqual(dependencies.calls.stops, ['profile-1']);
    assert.equal(dependencies.calls.outputTailers, 1);
  });

  it('reveals logs and opens the token detector output channel', async () => {
    const executedCommands: string[] = [];
    (vscode.commands as unknown as {
      executeCommand: (command: string, ...args: unknown[]) => Promise<unknown>;
    }).executeCommand = async (command) => {
      executedCommands.push(command);
    };
    const dependencies = register();

    await registeredHandlers.get('cursorAccounts.proxy.showLogs')!();
    await registeredHandlers.get('cursorAccounts.proxy.showTokenDetector')!();

    assert.deepEqual(executedCommands, ['revealFileInOS']);
    assert.equal(dependencies.calls.tokenChannels, 1);
  });

  it('requires confirmation before deleting logs and reports failures', async () => {
    const confirmations: Array<string | undefined> = [undefined, 'Delete'];
    const errors: string[] = [];
    windowMessages().showWarningMessage = async () => confirmations.shift();
    windowMessages().showErrorMessage = (message) => errors.push(message);
    const dependencies = register({
      clearLogFiles: async () => {
        throw new Error('disk full');
      },
    });

    await registeredHandlers.get('cursorAccounts.proxy.clearLogs')!();
    assert.equal(dependencies.calls.clears, 0);
    await registeredHandlers.get('cursorAccounts.proxy.clearLogs')!();

    assert.equal(dependencies.calls.clears, 1);
    assert.ok(errors.some((message) => message.includes('disk full')));
  });

  it('reports a missing certificate when saving is requested', async () => {
    const errors: string[] = [];
    windowMessages().showErrorMessage = (message) => errors.push(message);
    register();

    await registeredHandlers.get('cursorAccounts.proxy.saveCertificate')!();

    assert.ok(errors.some((message) => message.includes('Certificate not found')));
  });
});
