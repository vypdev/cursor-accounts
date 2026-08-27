import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildProfileLaunchQuickPickItems } from '../commands/profileLaunchPresentation';
import type { Profile } from '../profiles/types';

function createProfile(overrides: Partial<Profile> = {}): Profile {
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

describe('profile launch presentation policy', () => {
  it('maps profile identity and formatted launch time to a quick-pick item', () => {
    const profile = createProfile({ lastLaunched: '2026-08-26T12:00:00.000Z' });

    assert.deepEqual(
      buildProfileLaunchQuickPickItems(
        [profile],
        {
          lastLaunched: (date) => `Last launched: ${date}`,
          lastLaunchedNever: 'Never',
        },
        (date) => `formatted(${date})`
      ),
      [
        {
          label: 'Work',
          description: 'work@example.com',
          detail: 'Last launched: formatted(2026-08-26T12:00:00.000Z)',
          profile,
        },
      ]
    );
  });

  it('uses the localized never label when a profile has not been launched', () => {
    const profile = createProfile();

    const items = buildProfileLaunchQuickPickItems(
      [profile],
      {
        lastLaunched: (date) => `Last launched: ${date}`,
        lastLaunchedNever: 'Never',
      },
      () => {
        throw new Error('date formatter must not run for an absent timestamp');
      }
    );

    assert.equal(items[0]?.detail, 'Last launched: Never');
  });

  it('returns no choices for an empty profile collection', () => {
    assert.deepEqual(
      buildProfileLaunchQuickPickItems(
        [],
        { lastLaunched: (date) => date, lastLaunchedNever: 'Never' },
        (date) => date
      ),
      []
    );
  });
});
