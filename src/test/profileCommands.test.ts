import './registerVscodeMock';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as vscode from 'vscode';
import { registerProfileCommands } from '../commands/profileCommands';
import type { Profile } from '../profiles/types';

const registeredHandlers = new Map<string, () => Promise<void>>();

const originalRegister = vscode.commands.registerCommand;

beforeEach(() => {
  registeredHandlers.clear();
  (vscode.commands as { registerCommand: typeof originalRegister }).registerCommand =
    ((command: string, callback: () => Promise<void>) => {
      registeredHandlers.set(command, callback);
      return { dispose: () => registeredHandlers.delete(command) };
    }) as typeof originalRegister;
});

function createMockProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-1',
    slug: 'work',
    email: 'work@example.com',
    displayName: 'Work',
    userDataDir: '/tmp/.cursor-work',
    created: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('registerProfileCommands', () => {
  it('registers expected profile command handlers', () => {
    const context = { subscriptions: [] as { dispose: () => void }[] };

    registerProfileCommands(
      context as never,
      {
        getProfiles: async () => [],
        validateEmail: () => ({ valid: true, errors: [] }),
      } as never,
      {
        launch: async () => ({ success: true }),
        validateExecutable: async () => ({ valid: true }),
      } as never,
      {
        detectCurrentProfile: async () => null,
      } as never
    );

    const expected = [
      'cursorAccounts.addProfile',
      'cursorAccounts.launchProfile',
      'cursorAccounts.listProfiles',
      'cursorAccounts.deleteProfile',
      'cursorAccounts.showCurrentProfile',
      'cursorAccounts.exportProfiles',
      'cursorAccounts.importProfiles',
    ];

    for (const command of expected) {
      assert.ok(
        registeredHandlers.has(command),
        `missing handler for ${command}`
      );
    }
  });

  it('showCurrentProfile reports default when no profile detected', async () => {
    const messages: string[] = [];
    (vscode.window as { showInformationMessage: (m: string) => void }).showInformationMessage =
      (message: string) => {
        messages.push(message);
      };

    const context = { subscriptions: [] as { dispose: () => void }[] };
    registerProfileCommands(
      context as never,
      { getProfiles: async () => [] } as never,
      {} as never,
      { detectCurrentProfile: async () => null } as never
    );

    const handler = registeredHandlers.get('cursorAccounts.showCurrentProfile');
    assert.ok(handler);
    await handler!();

    assert.equal(messages.length, 1);
  });

  it('listProfiles writes profile lines to output channel', async () => {
    const lines: string[] = [];
    const extensionLog = await import('../logging/extensionLog');
    const originalAppend = extensionLog.appendLine;
    const originalClear = extensionLog.clear;
    const originalShow = extensionLog.show;

    extensionLog.appendLine = (line: string) => {
      lines.push(line);
    };
    extensionLog.clear = () => {
      lines.length = 0;
    };
    extensionLog.show = () => undefined;

    try {
      const context = { subscriptions: [] as { dispose: () => void }[] };
      const profile = createMockProfile();

      registerProfileCommands(
        context as never,
        {
          getProfiles: async () => [profile],
        } as never,
        {} as never,
        {
          detectCurrentProfile: async () => profile,
        } as never
      );

      const handler = registeredHandlers.get('cursorAccounts.listProfiles');
      assert.ok(handler);
      await handler!();

      assert.ok(lines.some((line) => line.includes('Work')));
      assert.ok(lines.some((line) => line.includes('work@example.com')));
    } finally {
      extensionLog.appendLine = originalAppend;
      extensionLog.clear = originalClear;
      extensionLog.show = originalShow;
    }
  });
});
