import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'node:test';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import type { IUserService } from '../domain/ports/IUserService';
import { ProfileAccountFetcher } from '../services/profileAccountFetcher';

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
  it('returns error when no tokens found for profile', async () => {
    const fetcher = new ProfileAccountFetcher(
      createAuthReader(null),
      createUserService()
    );

    const result = await fetcher.fetchAllProfileAccounts([
      {
        id: 'p1',
        email: 'test@example.com',
        slug: 'test',
        displayName: 'Test',
        userDataDir: path.join(os.homedir(), '.cursor-test-profile-fetcher'),
        created: new Date().toISOString(),
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
});
