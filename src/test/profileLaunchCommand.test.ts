import './registerVscodeMock';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as vscode from 'vscode';
import { registerProfileLaunchCommands } from '../commands/registerProfileLaunchCommands';
import type { Profile } from '../profiles/types';

type CommandHandler = () => Promise<void>;
type InformationMessage = (
  message: string,
  ...items: string[]
) => Promise<string | undefined>;
type QuickPick = (
  items: readonly unknown[],
  options?: unknown
) => Promise<unknown>;
type ErrorMessage = (message: string) => void;

const originalRegisterCommand = vscode.commands.registerCommand;
const originalExecuteCommand = vscode.commands.executeCommand;
const originalShowInformationMessage = (
  vscode.window as unknown as { showInformationMessage?: InformationMessage }
).showInformationMessage;
const originalShowQuickPick = (
  vscode.window as unknown as { showQuickPick?: QuickPick }
).showQuickPick;
const originalShowErrorMessage = (
  vscode.window as unknown as { showErrorMessage?: ErrorMessage }
).showErrorMessage;

let launchHandler: CommandHandler | undefined;
let informationMessages: string[];
let errorMessages: string[];
let quickPickItems: readonly unknown[];
let quickPickSelection: unknown;
let informationSelection: string | undefined;
let executedCommands: string[];

const PROFILE: Profile = {
  id: 'profile-1',
  slug: 'work',
  email: 'work@example.com',
  displayName: 'Work',
  userDataDir: '/tmp/.cursor-work',
  created: '2024-01-01T00:00:00.000Z',
};

beforeEach(() => {
  launchHandler = undefined;
  informationMessages = [];
  errorMessages = [];
  quickPickItems = [];
  quickPickSelection = undefined;
  informationSelection = undefined;
  executedCommands = [];

  (vscode.commands as unknown as {
    registerCommand: typeof vscode.commands.registerCommand;
  }).registerCommand = ((command: string, callback: CommandHandler) => {
    if (command === 'cursorAccounts.launchProfile') {
      launchHandler = callback;
    }
    return { dispose: () => undefined };
  }) as typeof vscode.commands.registerCommand;
  (vscode.commands as unknown as {
    executeCommand: typeof vscode.commands.executeCommand;
  }).executeCommand = (async (command: string) => {
    executedCommands.push(command);
    return undefined;
  }) as typeof vscode.commands.executeCommand;

  (vscode.window as unknown as { showInformationMessage: InformationMessage })
    .showInformationMessage = async (message, ..._items) => {
    informationMessages.push(message);
    return informationSelection;
  };
  (vscode.window as unknown as { showQuickPick: QuickPick }).showQuickPick =
    async (items) => {
      quickPickItems = items;
      return quickPickSelection;
    };
  (vscode.window as unknown as { showErrorMessage: ErrorMessage })
    .showErrorMessage = (message) => {
    errorMessages.push(message);
  };
});

afterEach(() => {
  vscode.commands.registerCommand = originalRegisterCommand;
  vscode.commands.executeCommand = originalExecuteCommand;
  (vscode.window as unknown as { showInformationMessage?: InformationMessage })
    .showInformationMessage = originalShowInformationMessage;
  (vscode.window as unknown as { showQuickPick?: QuickPick }).showQuickPick =
    originalShowQuickPick;
  (vscode.window as unknown as { showErrorMessage?: ErrorMessage })
    .showErrorMessage = originalShowErrorMessage;
});

describe('registerProfileLaunchCommands', () => {
  it('offers profile creation when no profiles exist and the user accepts', async () => {
    informationSelection = 'Create profile';
    const context = { subscriptions: [] as { dispose: () => void }[] };

    registerProfileLaunchCommands(
      context as never,
      {
        profileManager: { getProfiles: async () => [] },
        profileLauncher: {},
      } as never
    );

    await getLaunchHandler()();

    assert.deepEqual(executedCommands, ['cursorAccounts.addProfile']);
    assert.equal(informationMessages.length, 1);
  });

  it('does not execute profile creation when the no-profile prompt is dismissed', async () => {
    registerProfileLaunchCommands(
      { subscriptions: [] } as never,
      {
        profileManager: { getProfiles: async () => [] },
        profileLauncher: {},
      } as never
    );

    await getLaunchHandler()();

    assert.deepEqual(executedCommands, []);
  });

  it('does nothing when profile selection is cancelled', async () => {
    registerProfileLaunchCommands(
      { subscriptions: [] } as never,
      {
        profileManager: { getProfiles: async () => [PROFILE] },
        profileLauncher: {
          validateExecutable: async () => ({ valid: true }),
        },
      } as never
    );

    await getLaunchHandler()();

    assert.equal(quickPickItems.length, 1);
    assert.equal(errorMessages.length, 0);
  });

  it('reports an unavailable executable without launching the selected profile', async () => {
    quickPickSelection = { profile: PROFILE };
    registerProfileLaunchCommands(
      { subscriptions: [] } as never,
      {
        profileManager: { getProfiles: async () => [PROFILE] },
        profileLauncher: {
          validateExecutable: async () => ({
            valid: false,
            error: 'Cursor executable unavailable',
          }),
          launch: async () => {
            throw new Error('launch must not run');
          },
        },
      } as never
    );

    await getLaunchHandler()();

    assert.deepEqual(errorMessages, ['Cursor executable unavailable']);
  });

  it('reports successful profile launches', async () => {
    quickPickSelection = { profile: PROFILE };
    const launched: string[] = [];
    registerProfileLaunchCommands(
      { subscriptions: [] } as never,
      {
        profileManager: { getProfiles: async () => [PROFILE] },
        profileLauncher: {
          validateExecutable: async () => ({ valid: true }),
          launch: async (profileId: string) => {
            launched.push(profileId);
            return { success: true };
          },
        },
      } as never
    );

    await getLaunchHandler()();

    assert.deepEqual(launched, ['profile-1']);
    assert.equal(informationMessages.length, 1);
  });

  it('reports failed profile launches', async () => {
    quickPickSelection = { profile: PROFILE };
    registerProfileLaunchCommands(
      { subscriptions: [] } as never,
      {
        profileManager: { getProfiles: async () => [PROFILE] },
        profileLauncher: {
          validateExecutable: async () => ({ valid: true }),
          launch: async () => ({ success: false, error: 'Launch failed' }),
        },
      } as never
    );

    await getLaunchHandler()();

    assert.deepEqual(errorMessages, ['Failed to launch profile: Launch failed']);
  });

  it('reports unexpected command failures', async () => {
    registerProfileLaunchCommands(
      { subscriptions: [] } as never,
      {
        profileManager: {
          getProfiles: async () => {
            throw new Error('Profile storage unavailable');
          },
        },
        profileLauncher: {},
      } as never
    );

    await getLaunchHandler()();

    assert.deepEqual(errorMessages, [
      'Failed to launch profile: Profile storage unavailable',
    ]);
  });
});

function getLaunchHandler(): CommandHandler {
  assert.ok(launchHandler);
  return launchHandler;
}
