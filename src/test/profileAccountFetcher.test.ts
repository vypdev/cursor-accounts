import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'node:test';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import type { IUserService } from '../domain/ports/IUserService';
import { ProfileAccountFetcher } from '../services/profileAccountFetcher';

const PROFILE = {
  id: 'p1',
  email: 'test@example.com',
  slug: 'test',
  displayName: 'Test',
  userDataDir: path.join(os.homedir(), '.cursor-test-profile-fetcher'),
  created: new Date().toISOString(),
};

function createAuthReader(
  tokens: { accessToken: string; email?: string } | null
): IProfileAuthReader {
  return {
    readTokens: async () => tokens,
  };
}

function createUserService(): IUserService {
  return {
    fetchAccount: async () => ({
      name: 'Test User',
      picture: 'https://example.com/avatar.png',
    }),
  };
}

describe('ProfileAccountFetcher', () => {
  it('returns an empty map without querying dependencies for no profiles', async () => {
    let authReads = 0;
    const fetcher = new ProfileAccountFetcher(
      {
        readTokens: async () => {
          authReads += 1;
          return null;
        },
      },
      createUserService()
    );

    const result = await fetcher.fetchAllProfileAccounts([]);

    assert.deepEqual(result, new Map());
    assert.equal(authReads, 0);
  });

  it('fetches and maps account data for a profile and active window', async () => {
    const requestedTokens: string[] = [];
    const fetcher = new ProfileAccountFetcher(
      createAuthReader({ accessToken: 'access-token' }),
      {
        fetchAccount: async (accessToken) => {
          requestedTokens.push(accessToken);
          return { name: 'Mapped User', picture: 'avatar' };
        },
      }
    );

    const profiles = await fetcher.fetchAllProfileAccounts([PROFILE]);
    const active = await fetcher.fetchActiveWindowAccount(PROFILE.userDataDir, 'active');

    assert.deepEqual(profiles.get('p1') && {
      profileId: profiles.get('p1')?.profileId,
      accountName: profiles.get('p1')?.accountName,
      pictureUrl: profiles.get('p1')?.pictureUrl,
    }, {
      profileId: 'p1',
      accountName: 'Mapped User',
      pictureUrl: 'avatar',
    });
    assert.deepEqual(active && {
      profileId: active.profileId,
      accountName: active.accountName,
      pictureUrl: active.pictureUrl,
    }, {
      profileId: 'active',
      accountName: 'Mapped User',
      pictureUrl: 'avatar',
    });
    assert.deepEqual(requestedTokens, ['access-token', 'access-token']);
  });

  it('returns error when no tokens found for profile', async () => {
    const fetcher = new ProfileAccountFetcher(
      createAuthReader(null),
      createUserService()
    );

    const result = await fetcher.fetchAllProfileAccounts([
      {
        ...PROFILE,
      },
    ]);

    const account = result.get('p1');
    assert.ok(account);
    assert.ok(account.error?.includes('No authentication tokens'));
  });

  it('returns error for invalid user data path', async () => {
    const fetcher = new ProfileAccountFetcher(
      createAuthReader(null),
      createUserService()
    );

    const result = await fetcher.fetchActiveWindowAccount('/etc/passwd');
    assert.ok(result);
    assert.ok(result.error);
  });

  it('uses the active-window missing-token message', async () => {
    const fetcher = new ProfileAccountFetcher(
      createAuthReader(null),
      createUserService()
    );

    const result = await fetcher.fetchActiveWindowAccount(PROFILE.userDataDir);

    assert.equal(result?.error, 'No authentication tokens found.');
  });

  it('maps authentication failures to a re-login instruction', async () => {
    const fetcher = new ProfileAccountFetcher(
      createAuthReader({ accessToken: 'expired-token' }),
      {
        fetchAccount: async () => {
          throw new Error('401 Unauthorized');
        },
      }
    );

    const result = await fetcher.fetchActiveWindowAccount(PROFILE.userDataDir);

    assert.equal(
      result?.error,
      'Authentication expired. Launch profile to sign in again.'
    );
  });

  it('preserves non-authentication errors', async () => {
    const failingFetcher = new ProfileAccountFetcher(
      createAuthReader({ accessToken: 'access-token' }),
      {
        fetchAccount: async () => {
          throw new Error('service unavailable');
        },
      }
    );

    const failure = await failingFetcher.fetchActiveWindowAccount(
      PROFILE.userDataDir
    );

    assert.equal(failure?.error, 'service unavailable');
  });

  it('returns a profile-specific invalid-path and missing-token result', async () => {
    const fetcher = new ProfileAccountFetcher(
      createAuthReader(null),
      createUserService()
    );

    const result = await fetcher.fetchAllProfileAccounts([
      { ...PROFILE, id: 'invalid', userDataDir: '/etc/passwd' },
      { ...PROFILE, id: 'missing' },
    ]);

    assert.equal(result.get('invalid')?.error, 'Path must be within user home directory');
    assert.equal(
      result.get('missing')?.error,
      'No authentication tokens found. Launch profile to sign in.'
    );
  });
});
