import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Profile } from '../profiles/types';
import {
  buildSuggestedProfileResponse,
  generateDisplayNameFromEmail,
} from '../ui/suggestedProfile';

describe('suggestedProfile', () => {
  const existingProfile: Profile = {
    id: 'profile-1',
    email: 'user@example.com',
    slug: 'user_example_com',
    displayName: 'User',
    userDataDir: '/tmp/user',
    created: '2026-01-01T00:00:00.000Z',
  };

  it('returns empty response when no email is detected', () => {
    const response = buildSuggestedProfileResponse(undefined, undefined);

    assert.deepEqual(response, {
      type: 'suggestedProfile',
      email: undefined,
      displayName: undefined,
    });
  });

  it('returns notice when email already exists in stored profiles', () => {
    const response = buildSuggestedProfileResponse(
      'user@example.com',
      existingProfile
    );

    assert.equal(response.type, 'suggestedProfile');
    assert.equal(response.email, undefined);
    assert.equal(response.displayName, undefined);
    assert.match(
      response.notice ?? '',
      /La cuenta user@example\.com ya está configurada/
    );
  });

  it('returns email and display name for a new detected account', () => {
    const response = buildSuggestedProfileResponse(
      'new.user@example.com',
      undefined
    );

    assert.deepEqual(response, {
      type: 'suggestedProfile',
      email: 'new.user@example.com',
      displayName: 'New User',
    });
  });

  it('generates display name from email local part', () => {
    assert.equal(
      generateDisplayNameFromEmail('john.doe@company.com'),
      'John Doe'
    );
  });
});
