import './registerVscodeMock';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import * as vscode from 'vscode';
import { registerProfileCommands } from '../commands/profileCommands';
import { PROFILE_EXPORT_VERSION, type Profile, type ProfileExport } from '../profiles/types';

const registeredHandlers = new Map<string, () => Promise<void>>();

type RegisterCommand = typeof vscode.commands.registerCommand;

beforeEach(() => {
  registeredHandlers.clear();
  (vscode.commands as { registerCommand: RegisterCommand }).registerCommand =
    ((command: string, callback: () => Promise<void>) => {
      registeredHandlers.set(command, callback);
      return { dispose: () => registeredHandlers.delete(command) };
    }) as RegisterCommand;
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

  it('exports the selected profiles through the command dialogs', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-command-export-')
    );
    const exportPath = path.join(tempDir, 'profiles.json');
    const profile = createMockProfile();
    const messages: string[] = [];
    const windowApi = vscode.window as unknown as {
      showQuickPick: (items: unknown[]) => Promise<unknown[] | string | undefined>;
      showSaveDialog: () => Promise<{ fsPath: string } | undefined>;
      showInformationMessage: (message: string) => void;
    };
    const originalQuickPick = windowApi.showQuickPick;
    const originalSaveDialog = windowApi.showSaveDialog;
    const originalInformationMessage = windowApi.showInformationMessage;

    windowApi.showQuickPick = async (items) =>
      Array.isArray(items) &&
      typeof items[0] === 'object' &&
      items[0] !== null &&
      'id' in items[0]
        ? [items[1]]
        : 'No';
    windowApi.showSaveDialog = async () => ({ fsPath: exportPath });
    windowApi.showInformationMessage = (message) => {
      messages.push(message);
    };

    try {
      registerProfileCommands(
        { subscriptions: [] } as never,
        { getProfiles: async () => [profile] } as never,
        {} as never,
        { detectCurrentProfile: async () => profile } as never
      );

      await registeredHandlers.get('cursorAccounts.exportProfiles')!();

      const exported = JSON.parse(await fs.readFile(exportPath, 'utf8')) as ProfileExport;
      assert.equal(exported.profiles.length, 1);
      assert.equal(exported.profiles[0]?.email, profile.email);
      assert.equal(messages.length, 1);
    } finally {
      windowApi.showQuickPick = originalQuickPick;
      windowApi.showSaveDialog = originalSaveDialog;
      windowApi.showInformationMessage = originalInformationMessage;
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('imports a valid profile through the command dialogs', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-command-import-')
    );
    const importPath = path.join(tempDir, 'profiles.json');
    const importedProfile = createMockProfile({ email: 'imported@example.com' });
    const exportData: ProfileExport = {
      version: PROFILE_EXPORT_VERSION,
      exportedAt: '2026-08-27T00:00:00.000Z',
      profiles: [
        {
          email: importedProfile.email,
          displayName: importedProfile.displayName,
        },
      ],
    };
    await fs.writeFile(importPath, JSON.stringify(exportData), 'utf8');

    const messages: string[] = [];
    const windowApi = vscode.window as unknown as {
      showOpenDialog: () => Promise<Array<{ fsPath: string }> | undefined>;
      showInformationMessage: (message: string) => void;
    };
    const originalOpenDialog = windowApi.showOpenDialog;
    const originalInformationMessage = windowApi.showInformationMessage;
    windowApi.showOpenDialog = async () => [{ fsPath: importPath }];
    windowApi.showInformationMessage = (message) => {
      messages.push(message);
    };

    try {
      registerProfileCommands(
        { subscriptions: [] } as never,
        {
          getProfiles: async () => [],
          validateEmail: () => ({ valid: true, errors: [] }),
          createProfile: async () => importedProfile,
          updateProfile: async () => importedProfile,
        } as never,
        {} as never,
        { detectCurrentProfile: async () => null } as never
      );

      await registeredHandlers.get('cursorAccounts.importProfiles')!();

      assert.equal(messages.length, 1);
      assert.match(messages[0] ?? '', /Imported: 1/);
    } finally {
      windowApi.showOpenDialog = originalOpenDialog;
      windowApi.showInformationMessage = originalInformationMessage;
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('reports an invalid import file without invoking profile writes', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-command-invalid-import-')
    );
    const importPath = path.join(tempDir, 'invalid.json');
    await fs.writeFile(importPath, JSON.stringify({ invalid: true }), 'utf8');

    const errors: string[] = [];
    const windowApi = vscode.window as unknown as {
      showOpenDialog: () => Promise<Array<{ fsPath: string }> | undefined>;
      showErrorMessage: (message: string) => void;
    };
    const originalOpenDialog = windowApi.showOpenDialog;
    const originalErrorMessage = windowApi.showErrorMessage;
    windowApi.showOpenDialog = async () => [{ fsPath: importPath }];
    windowApi.showErrorMessage = (message) => {
      errors.push(message);
    };

    try {
      registerProfileCommands(
        { subscriptions: [] } as never,
        { getProfiles: async () => [] } as never,
        {} as never,
        { detectCurrentProfile: async () => null } as never
      );

      await registeredHandlers.get('cursorAccounts.importProfiles')!();

      assert.equal(errors.length, 1);
      assert.match(errors[0] ?? '', /Invalid export file format/);
    } finally {
      windowApi.showOpenDialog = originalOpenDialog;
      windowApi.showErrorMessage = originalErrorMessage;
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
