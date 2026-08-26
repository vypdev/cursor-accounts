import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OAuthTokenClient } from '../../auth/oauthTokenClient';

describe('OAuthTokenClient', () => {
  it('sends the refresh grant and preserves a non-rotated refresh token', async () => {
    let requestUrl: string | URL | Request | undefined;
    let requestInit: RequestInit | undefined;
    const signal = new AbortController().signal;
    const client = new OAuthTokenClient({
      fetch: async (input, init) => {
        requestUrl = input;
        requestInit = init;
        return new Response(JSON.stringify({ access_token: 'new-access' }), {
          status: 200,
        });
      },
    });

    const tokens = await client.refreshTokens('old-refresh', signal);

    assert.deepEqual(tokens, {
      accessToken: 'new-access',
      refreshToken: 'old-refresh',
    });
    assert.equal(requestUrl, 'https://api2.cursor.sh/oauth/token');
    assert.equal(requestInit?.method, 'POST');
    assert.equal(requestInit?.signal, signal);
    assert.deepEqual(requestInit?.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(String(requestInit?.body)), {
      grant_type: 'refresh_token',
      client_id: 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB',
      refresh_token: 'old-refresh',
    });
  });

  it('returns a rotated refresh token from OAuth', async () => {
    const client = new OAuthTokenClient({
      fetch: async () =>
        new Response(
          JSON.stringify({
            access_token: 'new-access',
            refresh_token: 'new-refresh',
          }),
          { status: 200 }
        ),
    });

    assert.deepEqual(await client.refreshTokens('old-refresh'), {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
  });

  it('reports OAuth error details for unsuccessful responses', async () => {
    const client = new OAuthTokenClient({
      fetch: async () =>
        new Response(
          JSON.stringify({ error: 'invalid_grant', error_description: 'refresh expired' }),
          { status: 400, statusText: 'Bad Request' }
        ),
    });

    await assert.rejects(
      () => client.refreshTokens('old-refresh'),
      /Token refresh failed: refresh expired/
    );
  });

  it('rejects a successful response without an access token', async () => {
    const client = new OAuthTokenClient({
      fetch: async () => new Response(JSON.stringify({}), { status: 200, statusText: 'OK' }),
    });

    await assert.rejects(
      () => client.refreshTokens('old-refresh'),
      /Token refresh failed: OK/
    );
  });
});
