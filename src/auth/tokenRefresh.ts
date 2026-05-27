import * as vscode from 'vscode';
import { CursorAuthTokens } from '../api/types';
import { SECRETS_KEYS } from './cursorPaths';
import { isTokenExpired, readAuthFromStateDb } from './tokenReader';

const OAUTH_TOKEN_URL = 'https://api2.cursor.sh/oauth/token';
const OAUTH_CLIENT_ID = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB';

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

export class TokenService {
  private readonly extensionPath: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.extensionPath = context.extensionPath;
  }

  async getValidTokens(signal?: AbortSignal): Promise<CursorAuthTokens> {
    const fromSecrets = await this.readFromSecrets();
    if (fromSecrets?.accessToken && !isTokenExpired(fromSecrets.accessToken)) {
      return fromSecrets;
    }

    const fromDb = readAuthFromStateDb(this.extensionPath);
    if (!fromDb?.accessToken) {
      throw new Error(
        'Cursor is not signed in. Sign in via Cursor Settings, then reload the window.'
      );
    }

    if (!isTokenExpired(fromDb.accessToken)) {
      await this.persistTokens(fromDb);
      return fromDb;
    }

    if (!fromDb.refreshToken) {
      const refreshed = await this.readFromSecrets();
      if (refreshed?.refreshToken) {
        fromDb.refreshToken = refreshed.refreshToken;
      }
    }

    if (!fromDb.refreshToken) {
      throw new Error(
        'Cursor session expired. Sign in again via Cursor Settings.'
      );
    }

    const refreshed = await this.refreshTokens(fromDb.refreshToken, signal);
    await this.persistTokens(refreshed);
    return refreshed;
  }

  private async readFromSecrets(): Promise<CursorAuthTokens | null> {
    const accessToken = await this.context.secrets.get(
      SECRETS_KEYS.accessToken
    );
    if (!accessToken) {
      return null;
    }
    const refreshToken = await this.context.secrets.get(
      SECRETS_KEYS.refreshToken
    );
    return { accessToken, refreshToken };
  }

  private async persistTokens(tokens: CursorAuthTokens): Promise<void> {
    await this.context.secrets.store(
      SECRETS_KEYS.accessToken,
      tokens.accessToken
    );
    if (tokens.refreshToken) {
      await this.context.secrets.store(
        SECRETS_KEYS.refreshToken,
        tokens.refreshToken
      );
    }
  }

  async refreshTokens(
    refreshToken: string,
    signal?: AbortSignal
  ): Promise<CursorAuthTokens> {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: OAUTH_CLIENT_ID,
        refresh_token: refreshToken,
      }),
      signal,
    });

    const body = (await response.json()) as OAuthTokenResponse;

    if (!response.ok || !body.access_token) {
      const detail =
        body.error_description ?? body.error ?? response.statusText;
      throw new Error(`Token refresh failed: ${detail}`);
    }

    const tokens: CursorAuthTokens = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? refreshToken,
    };
    await this.persistTokens(tokens);
    return tokens;
  }
}
