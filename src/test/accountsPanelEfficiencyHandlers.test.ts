import './registerVscodeMock';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import { initL10nForTests } from '../l10n';
import type { Profile, ToWebviewMessage } from '../profiles/types';
import {
  AccountsPanelEfficiencyHandlers,
  type AccountsPanelEfficiencyService,
} from '../ui/accountsPanelEfficiencyHandlers';

const PROFILE: Profile = {
  id: 'p1',
  email: 'user@example.com',
  slug: 'user',
  displayName: 'User',
  userDataDir: '/tmp/cursor-user',
  created: '2026-01-01T00:00:00.000Z',
};

describe('AccountsPanelEfficiencyHandlers', () => {
  it('rejects a toggle when the selected profile is not active', async () => {
    initL10nForTests({
      'errors.efficiencyWrongWindow': 'Open the profile window first',
    });
    let toggleCalled = false;
    const handlers = createHandlers({
      profileDetector: { detectCurrentProfile: async () => null },
      efficiencyService: {
        setEfficiencyEnabled: async () => {
          toggleCalled = true;
          return { profile: PROFILE, message: 'enabled' };
        },
      },
    });

    await assert.rejects(
      () => handlers.toggle('p1', true),
      (error: Error) => {
        assert.equal(error.message, 'Open the profile window first');
        return true;
      }
    );
    assert.equal(toggleCalled, false);
  });

  it('posts the service result and refreshes after a successful toggle', async () => {
    initL10nForTests({
      'errors.efficiencyWrongWindow': 'Open the profile window first',
    });
    let received: { profileId: string; enabled: boolean } | undefined;
    const postedMessages: ToWebviewMessage[] = [];
    let refreshCount = 0;
    const handlers = new AccountsPanelEfficiencyHandlers(
      {
        profileDetector: {
          detectCurrentProfile: async () => PROFILE,
        },
        efficiencyService: {
          setEfficiencyEnabled: async (profileId, enabled) => {
            received = { profileId, enabled };
            return { profile: PROFILE, message: 'Efficiency enabled' };
          },
        },
      },
      {
        postMessage: async (message) => {
          postedMessages.push(message);
        },
        refresh: async () => {
          refreshCount += 1;
        },
      }
    );

    await handlers.toggle('p1', true);

    assert.deepEqual(received, { profileId: 'p1', enabled: true });
    assert.deepEqual(postedMessages, [
      { type: 'success', message: 'Efficiency enabled' },
    ]);
    assert.equal(refreshCount, 1);
  });
});

function createHandlers(overrides: {
  profileDetector?: Partial<IProfileDetector>;
  efficiencyService?: Partial<AccountsPanelEfficiencyService>;
} = {}) {
  return new AccountsPanelEfficiencyHandlers(
    {
      profileDetector: {
        detectCurrentProfile: async () => PROFILE,
        ...overrides.profileDetector,
      },
      efficiencyService: {
        setEfficiencyEnabled: async () => ({
          profile: PROFILE,
          message: 'enabled',
        }),
        ...overrides.efficiencyService,
      },
    },
    {
      postMessage: async () => undefined,
      refresh: async () => undefined,
    }
  );
}
