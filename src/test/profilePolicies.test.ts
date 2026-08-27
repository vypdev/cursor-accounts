import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildProfileRecord,
  validateProfileEmail,
} from '../domain';

describe('profile policies', () => {
  it('validates the profile email invariant', () => {
    assert.deepEqual(validateProfileEmail('valid@example.com'), {
      valid: true,
      errors: [],
    });
    assert.deepEqual(validateProfileEmail('invalid'), {
      valid: false,
      errors: ['Email format is invalid'],
    });
  });

  it('builds a manual profile record from explicit generated values', () => {
    assert.deepEqual(
      buildProfileRecord(
        {
          email: 'john.doe@example.com',
          notes: 'Imported manually',
          tags: ['team'],
        },
        '/Users/test/.cursor-john_doe_example_com',
        {
          id: 'profile-id',
          created: '2026-08-27T00:00:00.000Z',
          color: '#123456',
          slug: 'john_doe_example_com',
          displayName: 'John Doe',
        }
      ),
      {
        id: 'profile-id',
        email: 'john.doe@example.com',
        slug: 'john_doe_example_com',
        displayName: 'John Doe',
        userDataDir: '/Users/test/.cursor-john_doe_example_com',
        created: '2026-08-27T00:00:00.000Z',
        color: '#123456',
        proxyEnabled: true,
        metadata: {
          source: 'manual',
          notes: 'Imported manually',
          tags: ['team'],
        },
      }
    );
  });
});
