import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import { TokenService } from '../auth/tokenRefresh';
import { getProfileSecretsKeys, getProfileStateDbPath } from '../auth/cursorPaths';

describe('TokenService profile scoping', () => {
  it('resolves active state database from profile detector user data dir', () => {
    const activeUserDataDir = path.join(os.tmpdir(), 'cursor-profile-work');
    const profileDetector = {
      getCurrentUserDataDir: () => activeUserDataDir,
    };

    const service = new TokenService({ extensionPath: '/tmp/ext' } as never, profileDetector as never);
    const stateDbPath = service.getActiveStateDbPath();

    assert.equal(stateDbPath, getProfileStateDbPath(activeUserDataDir));
    assert.ok(stateDbPath.includes('cursor-profile-work'));
  });

  it('generates distinct profile-scoped secret keys per user data dir', () => {
    const dirA = path.join(os.tmpdir(), 'profile-a');
    const dirB = path.join(os.tmpdir(), 'profile-b');

    const keysA = getProfileSecretsKeys(dirA);
    const keysB = getProfileSecretsKeys(dirB);

    assert.notEqual(keysA.accessToken, keysB.accessToken);
    assert.match(keysA.accessToken, /^cursorAccounts\.accessToken\./);
    assert.match(keysB.accessToken, /^cursorAccounts\.accessToken\./);
  });

  it('refreshes an expired profile secret instead of returning it', async () => {
    const originalFetch = globalThis.fetch;
    const userDataDir = path.join(
      os.homedir(),
      '.cursor-accounts-test',
      `cursor-profile-expired-${Date.now()}`
    );
    const profileKeys = getProfileSecretsKeys(userDataDir);
    const values = new Map<string, string>([
      [profileKeys.accessToken, 'eyJhbGciOiJub25lIn0.eyJleHAiOjF9.signature'],
      [profileKeys.refreshToken, 'profile-refresh'],
    ]);
    const context = {
      extensionPath: '/tmp/ext',
      secrets: {
        get: async (key: string) => values.get(key),
        store: async (key: string, value: string) => {
          values.set(key, value);
        },
      },
    };
    const profileDetector = { getCurrentUserDataDir: () => userDataDir };
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ access_token: 'refreshed-access' }), {
        status: 200,
      });

    try {
      const service = new TokenService(context as never, profileDetector as never);
      const tokens = await service.getValidTokens();

      assert.deepEqual(tokens, {
        accessToken: 'refreshed-access',
        refreshToken: 'profile-refresh',
      });
      assert.equal(values.get(profileKeys.accessToken), 'refreshed-access');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('TokenService.refreshTokens', () => {
  function createService() {
    const values = new Map<string, string>();
    const context = {
      extensionPath: '/tmp/ext',
      secrets: {
        get: async (key: string) => values.get(key),
        store: async (key: string, value: string) => {
          values.set(key, value);
        },
      },
    };
    const profileDetector = {
      getCurrentUserDataDir: () => '/tmp/cursor-profile',
    };
    return {
      service: new TokenService(context as never, profileDetector as never),
      values,
    };
  }

  it('stores the rotated refresh token returned by OAuth', async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, string> | undefined;
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, string>;
      return new Response(
        JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh' }),
        { status: 200 }
      );
    };

    try {
      const { service, values } = createService();
      const tokens = await service.refreshTokens('old-refresh', {
        accessToken: 'profile.access',
        refreshToken: 'profile.refresh',
      });

      assert.deepEqual(tokens, {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      });
      assert.deepEqual(requestBody, {
        grant_type: 'refresh_token',
        client_id: 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB',
        refresh_token: 'old-refresh',
      });
      assert.equal(values.get('profile.access'), 'new-access');
      assert.equal(values.get('profile.refresh'), 'new-refresh');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps the previous refresh token when OAuth does not rotate it', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ access_token: 'new-access' }), { status: 200 });

    try {
      const { service } = createService();
      const tokens = await service.refreshTokens('old-refresh', {
        accessToken: 'profile.access',
        refreshToken: 'profile.refresh',
      });
      assert.deepEqual(tokens, {
        accessToken: 'new-access',
        refreshToken: 'old-refresh',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('reports the OAuth error description for non-success responses', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'refresh expired' }),
        { status: 400, statusText: 'Bad Request' }
      );

    try {
      const { service } = createService();
      await assert.rejects(
        () => service.refreshTokens('old-refresh'),
        /Token refresh failed: refresh expired/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects an OAuth payload without an access token', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({}), { status: 200, statusText: 'OK' });

    try {
      const { service } = createService();
      await assert.rejects(
        () => service.refreshTokens('old-refresh'),
        /Token refresh failed: OK/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
