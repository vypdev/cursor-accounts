import './registerVscodeMock';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { describe, it } from 'node:test';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ProfileStorage } from '../profiles/profileStorage';

const registeredCommands = new Set<string>();

(vscode.commands as { registerCommand: typeof vscode.commands.registerCommand })
  .registerCommand = ((command: string) => {
  registeredCommands.add(command);
  return { dispose: () => registeredCommands.delete(command) };
}) as typeof vscode.commands.registerCommand;

describe('extension activate', () => {
  it('registers core extension commands on activate', async () => {
    const { activate, deactivate } = await import('../extension');
    const testRoot = await mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-extension-test-')
    );

    const context = {
      extensionPath: process.cwd(),
      subscriptions: [] as { dispose: () => void }[],
      globalStorageUri: {
        fsPath: path.join(
          testRoot,
          'cursor-user-data',
          'User',
          'globalStorage',
          'vypdev.cursor-accounts'
        ),
      },
      globalState: {
        get: () => undefined,
        update: async () => undefined,
      },
      secrets: {
        get: async () => undefined,
        store: async () => undefined,
      },
    };

    registeredCommands.clear();
    await activate(context as never, {
      createProfileStorage: () =>
        new ProfileStorage(path.join(testRoot, 'profile-config')),
      getSharedProxyStorageDir: () => path.join(testRoot, 'proxy'),
    });

    const expected = [
      'cursorAccounts.openAccounts',
      'cursorAccounts.refresh',
      'cursorAccounts.openUsage',
      'cursorAccounts.efficiency.showOutput',
      'cursorAccounts.efficiency.restartDetector',
      'cursorAccounts.addProfile',
      'cursorAccounts.launchProfile',
      'cursorAccounts.proxy.clearLogs',
    ];

    for (const command of expected) {
      assert.ok(
        registeredCommands.has(command),
        `activate did not register ${command}`
      );
    }

    await deactivate();
    for (const subscription of [...context.subscriptions].reverse()) {
      subscription.dispose();
    }
    await rm(testRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  });
});
