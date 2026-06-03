import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile } from '../profiles/types';
import { shouldAutoOpenAccountsPanel } from '../ui/accountsPanelStartup';

const PROFILE = {
  id: 'p1',
  email: 'user@example.com',
  slug: 'user',
  displayName: 'User',
  userDataDir: '/home/user/.cursor-user',
  created: '2024-01-01T00:00:00.000Z',
} as Profile;

describe('shouldAutoOpenAccountsPanel', () => {
  it('opens when no managed profile is assigned', () => {
    assert.equal(shouldAutoOpenAccountsPanel(null, false), true);
    assert.equal(shouldAutoOpenAccountsPanel(null, true), true);
  });

  it('opens when profile is active but no workspace is open', () => {
    assert.equal(shouldAutoOpenAccountsPanel(PROFILE, false), true);
  });

  it('does not open when profile is active and a workspace is open', () => {
    assert.equal(shouldAutoOpenAccountsPanel(PROFILE, true), false);
  });
});
