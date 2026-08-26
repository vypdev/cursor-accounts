import type { CursorAuthTokens } from '@cursor-accounts/types';
import type { IOAuthTokenClient } from '../domain/ports/IOAuthTokenClient';
import * as extensionLog from '../logging/extensionLog';
import {
  oauthTokenResponseSchema,
  parseJsonWithSchema,
} from '../validation/apiSchemas';

const OAUTH_TOKEN_URL = 'https://api2.cursor.sh/oauth/token';
const OAUTH_CLIENT_ID = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB';

export interface OAuthTokenClientDependencies {
  fetch: typeof fetch;
}

export class OAuthTokenClient implements IOAuthTokenClient {
  private readonly fetchImpl: typeof fetch;

  constructor(dependencies: OAuthTokenClientDependencies = { fetch }) {
    this.fetchImpl = dependencies.fetch;
  }

  async refreshTokens(
    refreshToken: string,
    signal?: AbortSignal
  ): Promise<CursorAuthTokens> {
    const response = await this.fetchImpl(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: OAUTH_CLIENT_ID,
        refresh_token: refreshToken,
      }),
      signal,
    });

    const body = parseJsonWithSchema(
      oauthTokenResponseSchema,
      await response.json(),
      'OAuth token response'
    );

    if (!response.ok || !body.access_token) {
      const detail =
        body.error_description ?? body.error ?? response.statusText;
      extensionLog.error(`[OAuthTokenClient] Token refresh failed: ${detail}`);
      throw new Error(`Token refresh failed: ${detail}`);
    }

    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? refreshToken,
    };
  }
}
