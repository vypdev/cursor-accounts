import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ProfilePathResolutionError,
  resolveProfilePath,
} from '../profiles/profilePathResolver';
import type { Profile } from '../profiles/types';

describe('profilePathResolver', () => {
  it('returns the base profile path when it is available', async () => {
    const result = await resolveProfilePath(
      'test@example.com',
      '/profiles',
      { findProfileByPath: async () => undefined }
    );

    assert.deepEqual(result, {
      slug: 'test_example_com',
      userDataDir: '/profiles/.cursor-test_example_com',
    });
  });

  it('uses a deterministic hashed path when the base path is occupied', async () => {
    const occupiedPaths: string[] = [];
    const result = await resolveProfilePath(
      'test@example.com',
      '/profiles',
      {
        findProfileByPath: async (userDataDir) => {
          occupiedPaths.push(userDataDir);
          return occupiedPaths.length === 1
            ? ({} as Profile)
            : undefined;
        },
      }
    );

    assert.equal(result.slug, 'test_example_com');
    assert.match(result.userDataDir, /\.cursor-test_example_com_[a-f0-9]{8}$/);
    assert.equal(result.collisionSlug?.startsWith('test_example_com_'), true);
  });

  it('fails closed when both candidate paths are occupied', async () => {
    await assert.rejects(
      () =>
        resolveProfilePath('test@example.com', '/profiles', {
          findProfileByPath: async () => ({}) as Profile,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProfilePathResolutionError);
        assert.match(error.message, /Both test_example_com and/);
        return true;
      }
    );
  });
});
