import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAgentTrackingDbPool } from '../../persistence/betterSqlite/sqliteAgentTrackingDbPool';

const extensionPath = join(__dirname, '..', '..', '..');

describe('SqliteAgentTrackingDbPool', () => {
  let tempDir = '';

  afterEach(async () => {
    if (!tempDir) {
      return;
    }
    await rm(tempDir, { recursive: true, force: true });
    tempDir = '';
  });

  async function createPool(
    profileIds: string[] = ['profile-a']
  ): Promise<SqliteAgentTrackingDbPool> {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-tracking-pool-'));
    const profileDbPaths = new Map(
      profileIds.map((profileId) => [profileId, join(tempDir, `${profileId}.db`)])
    );
    return new SqliteAgentTrackingDbPool(profileDbPaths, extensionPath);
  }

  it('rejects profiles without a configured database path', async () => {
    const pool = await createPool();

    try {
      await assert.rejects(
        () => pool.getRepositoryForProfile('missing-profile'),
        /No database path configured for profile missing-profile/
      );
    } finally {
      await pool.closeAll();
    }
  });

  it('shares concurrent initialization and reopens after a profile close', async () => {
    const pool = await createPool(['profile-a', 'profile-b']);

    try {
      const [first, second] = await Promise.all([
        pool.getRepositoryForProfile('profile-a'),
        pool.getRepositoryForProfile('profile-a'),
      ]);

      assert.strictEqual(first, second);

      const otherProfile = await pool.getRepositoryForProfile('profile-b');
      assert.notStrictEqual(first, otherProfile);

      await pool.closeProfile('missing-profile');
      await pool.closeProfile('profile-a');

      const reopened = await pool.getRepositoryForProfile('profile-a');
      assert.notStrictEqual(reopened, first);
    } finally {
      await pool.closeAll();
    }
  });

  it('waits for an in-flight profile initialization before closing it', async () => {
    const pool = await createPool();
    const opening = pool.getRepositoryForProfile('profile-a');

    try {
      await pool.closeProfile('profile-a');
      const opened = await opening;
      const reopened = await pool.getRepositoryForProfile('profile-a');

      assert.notStrictEqual(opened, reopened);
    } finally {
      await pool.closeAll();
    }
  });

  it('clears pending state when initialization fails', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-tracking-pool-'));
    const pool = new SqliteAgentTrackingDbPool(
      new Map([
        ['broken-profile', join(tempDir, 'missing-directory', 'broken.db')],
      ]),
      extensionPath
    );

    try {
      await assert.rejects(
        () => pool.getRepositoryForProfile('broken-profile'),
        /Failed to open database/
      );
      await assert.rejects(
        () => pool.getRepositoryForProfile('broken-profile'),
        /Failed to open database/
      );
    } finally {
      await pool.closeAll();
    }
  });
});
