import './registerVscodeMock';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vscode from 'vscode';
import type { IInstanceDetector } from '../domain/ports/IInstanceDetector';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import { initL10nForTests } from '../l10n';
import { PROFILE_EXPORT_VERSION } from '../profiles/types';
import type { Profile } from '../profiles/types';
import { AccountsPanelProfileHandlers } from '../ui/accountsPanelProfileHandlers';

const PROFILE: Profile = {
  id: 'p1',
  email: 'user@example.com',
  slug: 'user',
  displayName: 'User',
  userDataDir: '/tmp/cursor-user',
  created: '2024-01-01T00:00:00.000Z',
};

function createHandlers(overrides: {
  profileManager?: Partial<IProfileManager>;
  instanceDetector?: Partial<IInstanceDetector>;
} = {}) {
  const postedMessages: unknown[] = [];
  let refreshCount = 0;
  const handlers = new AccountsPanelProfileHandlers(
    {
      profileManager: {
        getProfile: async () => PROFILE,
        getProfiles: async () => [PROFILE],
        createProfile: async () => PROFILE,
        updateProfile: async () => PROFILE,
        deleteProfile: async () => undefined,
        ...overrides.profileManager,
      } as IProfileManager,
      instanceDetector: {
        ...overrides.instanceDetector,
      } as IInstanceDetector,
      profileProxyEditUseCase: {
        execute: async () => PROFILE,
      },
    },
    {
      postMessage: async (message) => {
        postedMessages.push(message);
      },
      refresh: async () => {
        refreshCount += 1;
      },
      refreshProxyStatus: async () => undefined,
    }
  );

  return { handlers, postedMessages, getRefreshCount: () => refreshCount };
}

describe('AccountsPanelProfileHandlers', () => {
  initL10nForTests({
    'errors.profileNotFound': 'Profile not found',
    'panel.profileCreated': 'Created {name}',
    'panel.profileDeleted': 'Deleted {name}',
    'panel.exported': 'Exported {count}',
    'panel.imported': 'Imported {count}',
    'panel.importCompleted': 'Import completed',
    'panel.importCompletedWithErrors': 'Import completed with errors',
  });

  it('creates a profile, reports success, and refreshes the panel', async () => {
    const { handlers, postedMessages, getRefreshCount } = createHandlers({
      profileManager: {
        createProfile: async (options) => ({
          ...PROFILE,
          email: options.email,
          displayName: options.displayName ?? PROFILE.displayName,
        }),
      },
    });

    await handlers.add({
      type: 'add',
      email: 'new@example.com',
      displayName: 'New user',
    });

    assert.deepEqual(postedMessages, [
      { type: 'success', message: 'Created New user' },
    ]);
    assert.equal(getRefreshCount(), 1);
  });

  it('deletes a profile through the instance detector and refreshes the panel', async () => {
    let deletedId: string | undefined;
    let deletedDetector: IInstanceDetector | undefined;
    const { handlers, postedMessages, getRefreshCount } = createHandlers({
      profileManager: {
        deleteProfile: async (profileId, instanceDetector) => {
          deletedId = profileId;
          deletedDetector = instanceDetector;
        },
      },
    });

    await handlers.delete('p1');

    assert.equal(deletedId, 'p1');
    assert.ok(deletedDetector);
    assert.deepEqual(postedMessages, [
      { type: 'success', message: 'Deleted User' },
    ]);
    assert.equal(getRefreshCount(), 1);
  });

  it('reveals an existing profile user-data directory in the operating system', async () => {
    let revealedPath: string | undefined;
    const commands = vscode.commands as unknown as {
      executeCommand: (...args: unknown[]) => Promise<unknown>;
    };
    const originalExecuteCommand = commands.executeCommand;
    commands.executeCommand = async (...args) => {
      if (args[0] === 'revealFileInOS') {
        revealedPath = (args[1] as { fsPath: string }).fsPath;
      }
    };

    try {
      const { handlers } = createHandlers();
      await handlers.showInExplorer('p1');
    } finally {
      commands.executeCommand = originalExecuteCommand;
    }

    assert.equal(revealedPath, PROFILE.userDataDir);
  });

  it('exports selected profiles as a downloadable webview message', async () => {
    const { handlers, postedMessages } = createHandlers();

    await handlers.exportProfiles(['p1'], false);

    assert.equal(postedMessages.length, 2);
    const exportMessage = postedMessages[0] as {
      type: string;
      data: string;
      filename: string;
    };
    assert.equal(exportMessage.type, 'exportData');
    assert.match(exportMessage.filename, /^cursor-profiles-export-\d{4}-\d{2}-\d{2}\.json$/);
    assert.equal(JSON.parse(exportMessage.data).profiles[0].email, PROFILE.email);
    assert.deepEqual(postedMessages[1], {
      type: 'success',
      message: 'Exported 1',
    });
  });

  it('imports profiles, refreshes after changes, and reports the result', async () => {
    const importedProfile = { ...PROFILE, email: 'imported@example.com' };
    const { handlers, postedMessages, getRefreshCount } = createHandlers({
      profileManager: {
        getProfiles: async () => [],
        createProfile: async () => importedProfile,
        updateProfile: async () => importedProfile,
      },
    });

    await handlers.importProfiles(
      JSON.stringify({
        version: PROFILE_EXPORT_VERSION,
        exportedAt: '2024-01-01T00:00:00.000Z',
        profiles: [
          { email: importedProfile.email, displayName: importedProfile.displayName },
        ],
      }),
      {
        skipDuplicates: true,
        overwriteExisting: false,
        importSettings: false,
        strictValidation: true,
      }
    );

    assert.equal(getRefreshCount(), 1);
    assert.deepEqual(postedMessages, [
      { type: 'success', message: 'Imported 1' },
    ]);
  });
});
