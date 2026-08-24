import './registerVscodeMock';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as vscode from 'vscode';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import { initL10nForTests } from '../l10n';
import type { Profile } from '../profiles/types';
import { AccountsPanelGithubHandlers } from '../ui/accountsPanelGithubHandlers';

const PROFILE: Profile = {
  id: 'p1',
  email: 'user@example.com',
  slug: 'user',
  displayName: 'User',
  userDataDir: '/tmp/cursor-user',
  created: '2024-01-01T00:00:00.000Z',
};

type OpenDialogWindow = {
  showOpenDialog: () => Promise<Array<{ fsPath: string }> | undefined>;
};

const windowWithDialog = vscode.window as unknown as OpenDialogWindow;
const originalShowOpenDialog = windowWithDialog.showOpenDialog;

afterEach(() => {
  windowWithDialog.showOpenDialog = originalShowOpenDialog;
});

function createHandlers(overrides: Partial<IProfileManager> = {}) {
  const postedMessages: unknown[] = [];
  let refreshCount = 0;
  const handlers = new AccountsPanelGithubHandlers(
    {
      profileManager: {
        getProfile: async () => PROFILE,
        updateProfile: async () => PROFILE,
        ...overrides,
      } as IProfileManager,
    },
    {
      postMessage: async (message) => {
        postedMessages.push(message);
      },
      refreshGithubSummaries: async () => {
        refreshCount += 1;
      },
    }
  );

  return { handlers, postedMessages, getRefreshCount: () => refreshCount };
}

describe('AccountsPanelGithubHandlers', () => {
  initL10nForTests({
    'errors.profileNotFound': 'Profile not found',
    'panel.githubTokenSelectFile': 'Select token file',
    'panel.githubTokenDialogTitle': 'GitHub token',
    'panel.githubTokenConfigured': 'Configured {name}',
    'panel.githubTokenCleared': 'Cleared {name}',
  });

  it('configures the selected token path and refreshes GitHub summaries', async () => {
    windowWithDialog.showOpenDialog = async () => [{ fsPath: '/tmp/token.txt' }];
    let updatedPath: string | undefined;
    const { handlers, postedMessages, getRefreshCount } = createHandlers({
      updateProfile: async (_id, updates) => {
        updatedPath = updates.githubTokenPath;
        return { ...PROFILE, ...updates };
      },
    });

    await handlers.configure('p1');

    assert.equal(updatedPath, '/tmp/token.txt');
    assert.deepEqual(postedMessages, [
      { type: 'success', message: 'Configured User' },
    ]);
    assert.equal(getRefreshCount(), 1);
  });

  it('does not update or refresh when token selection is cancelled', async () => {
    windowWithDialog.showOpenDialog = async () => undefined;
    let updateCalled = false;
    const { handlers, postedMessages, getRefreshCount } = createHandlers({
      updateProfile: async () => {
        updateCalled = true;
        return PROFILE;
      },
    });

    await handlers.configure('p1');

    assert.equal(updateCalled, false);
    assert.deepEqual(postedMessages, []);
    assert.equal(getRefreshCount(), 0);
  });

  it('reports an error before opening the picker for a missing profile', async () => {
    let dialogCalled = false;
    windowWithDialog.showOpenDialog = async () => {
      dialogCalled = true;
      return undefined;
    };
    const { handlers, postedMessages } = createHandlers({
      getProfile: async () => undefined,
    });

    await handlers.configure('missing');

    assert.equal(dialogCalled, false);
    assert.deepEqual(postedMessages, [
      { type: 'error', message: 'Profile not found' },
    ]);
  });

  it('clears a configured token and refreshes GitHub summaries', async () => {
    let clearedPath: string | undefined = 'existing-token';
    const { handlers, postedMessages, getRefreshCount } = createHandlers({
      getProfile: async () => ({ ...PROFILE, githubTokenPath: clearedPath }),
      updateProfile: async (_id, updates) => {
        clearedPath = updates.githubTokenPath;
        return { ...PROFILE, ...updates };
      },
    });

    await handlers.clear('p1');

    assert.equal(clearedPath, undefined);
    assert.deepEqual(postedMessages, [
      { type: 'success', message: 'Cleared User' },
    ]);
    assert.equal(getRefreshCount(), 1);
  });
});
