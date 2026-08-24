import './registerVscodeMock';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vscode from 'vscode';

const registeredCommands = new Set<string>();

(vscode.commands as { registerCommand: typeof vscode.commands.registerCommand })
  .registerCommand = ((command: string) => {
  registeredCommands.add(command);
  return { dispose: () => registeredCommands.delete(command) };
}) as typeof vscode.commands.registerCommand;

describe('extension activate', () => {
  it('registers core extension commands on activate', async () => {
    const { activate, deactivate } = await import('../extension');

    const context = {
      extensionPath: process.cwd(),
      subscriptions: [] as { dispose: () => void }[],
      globalStorageUri: {
        fsPath: '/tmp/cursor-accounts-test/globalStorage',
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
    activate(context as never);

    const expected = [
      'cursorAccounts.openAccounts',
      'cursorAccounts.refresh',
      'cursorAccounts.openUsage',
      'cursorAccounts.efficiency.showOutput',
      'cursorAccounts.efficiency.restartDetector',
      'cursorAccounts.addProfile',
      'cursorAccounts.launchProfile',
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
  });
});
