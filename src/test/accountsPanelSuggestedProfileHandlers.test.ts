import './registerVscodeMock';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import { initL10nForTests } from '../l10n';
import type { ToWebviewMessage } from '../profiles/types';
import { AccountsPanelSuggestedProfileHandlers } from '../ui/accountsPanelSuggestedProfileHandlers';

const PROFILE = {
  id: 'p1',
  email: 'user@example.com',
  slug: 'user',
  displayName: 'User',
  userDataDir: '/tmp/cursor-user',
  created: '2026-01-01T00:00:00.000Z',
};

describe('AccountsPanelSuggestedProfileHandlers', () => {
  it('does not read or post when the webview is inactive', async () => {
    let readCalled = false;
    const { handlers, postedMessages } = createHandlers({
      hasActiveWebview: () => false,
      authReader: {
        readTokens: async () => {
          readCalled = true;
          return null;
        },
      },
    });

    await handlers.request();

    assert.equal(readCalled, false);
    assert.deepEqual(postedMessages, []);
  });

  it('posts a generated suggestion for a new authenticated account', async () => {
    const { handlers, postedMessages } = createHandlers({
      authReader: {
        readTokens: async () => ({
          accessToken: 'access-token',
          email: 'new.user@example.com',
        }),
      },
    });

    await handlers.request();

    assert.deepEqual(postedMessages, [
      {
        type: 'suggestedProfile',
        email: 'new.user@example.com',
        displayName: 'New User',
      },
    ]);
  });

  it('posts a configured-account notice when the email already exists', async () => {
    const { handlers, postedMessages } = createHandlers({
      authReader: {
        readTokens: async () => ({
          accessToken: 'access-token',
          email: PROFILE.email,
        }),
      },
      profileManager: {
        findProfileByEmail: async () => PROFILE,
      },
    });

    await handlers.request();

    assert.equal(postedMessages[0]?.type, 'suggestedProfile');
    assert.match(
      (postedMessages[0] as Extract<ToWebviewMessage, { type: 'suggestedProfile' }>).notice ?? '',
      /already configured/
    );
  });

  it('posts an empty suggestion after a detection failure when still active', async () => {
    const { handlers, postedMessages } = createHandlers({
      authReader: {
        readTokens: async () => {
          throw new Error('state database unavailable');
        },
      },
    });

    await handlers.request();

    assert.deepEqual(postedMessages, [
      { type: 'suggestedProfile', email: undefined, displayName: undefined },
    ]);
  });
});

function createHandlers(overrides: {
  authReader?: Partial<IProfileAuthReader>;
  profileManager?: Partial<IProfileManager>;
  hasActiveWebview?: () => boolean;
} = {}) {
  const postedMessages: ToWebviewMessage[] = [];
  initL10nForTests({
    'suggestedProfile.accountAlreadyConfigured': 'Account {email} is already configured',
  });
  const handlers = new AccountsPanelSuggestedProfileHandlers(
    {
      profileDetector: {
        getCurrentUserDataDir: () => '/tmp/cursor-user',
      },
      authReader: {
        readTokens: async () => null,
        ...overrides.authReader,
      },
      profileManager: {
        findProfileByEmail: async () => undefined,
        ...overrides.profileManager,
      },
    },
    {
      postMessage: async (message) => {
        postedMessages.push(message);
      },
      hasActiveWebview: overrides.hasActiveWebview ?? (() => true),
    }
  );

  return { handlers, postedMessages };
}
