import type * as vscode from 'vscode';
import type { CursorAuthTokens } from '@cursor-accounts/types';
import type { IRefreshableTokenProvider } from '../domain/ports/ITokenProvider';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import * as extensionLog from '../logging/extensionLog';
import {
  getProfileSecretsKeys,
  getProfileStateDbPath,
  SECRETS_KEYS,
} from './cursorPaths';
import { isTokenExpired, readAuthFromStateDb } from './tokenReader';
import { oauthTokenResponseSchema, parseJsonWithSchema } from '../validation/apiSchemas';

const OAUTH_TOKEN_URL = 'https://api2.cursor.sh/oauth/token';
const OAUTH_CLIENT_ID = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB';

export class TokenService implements IRefreshableTokenProvider {
  private readonly extensionPath: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileDetector: IProfileDetector
  ) {
    this.extensionPath = context.extensionPath;
  }

  /** Resolve state.vscdb for the active Cursor window (respects --user-data-dir). */
  getActiveStateDbPath(): string {
    const userDataDir = this.profileDetector.getCurrentUserDataDir();
    return getProfileStateDbPath(userDataDir);
  }

  async getValidTokens(signal?: AbortSignal): Promise<CursorAuthTokens> {
    const userDataDir = this.profileDetector.getCurrentUserDataDir();
    const stateDbPath = getProfileStateDbPath(userDataDir);
    const profileSecrets = getProfileSecretsKeys(userDataDir);

    const fromDb = await readAuthFromStateDb(stateDbPath, this.extensionPath);
    if (!fromDb?.accessToken) {
      const fromSecrets = await this.readFromSecrets(profileSecrets);
      if (
        fromSecrets?.accessToken &&
        !isTokenExpired(fromSecrets.accessToken)
      ) {
        extensionLog.debug(
          '[TokenService] Using valid access token from profile-scoped secrets (no DB tokens)'
        );
        return fromSecrets;
      }

      const legacySecrets = await this.readFromSecrets(SECRETS_KEYS);
      if (
        legacySecrets?.accessToken &&
        !isTokenExpired(legacySecrets.accessToken)
      ) {
        extensionLog.debug(
          '[TokenService] Using access token from legacy global secrets'
        );
        return legacySecrets;
      }

      const refreshToken =
        fromSecrets?.refreshToken ?? legacySecrets?.refreshToken;
      if (refreshToken) {
        extensionLog.debug(
          '[TokenService] Profile/legacy access token expired; refreshing via OAuth'
        );
        return this.refreshTokens(refreshToken, profileSecrets, signal);
      }

      throw new Error(
        'Cursor is not signed in. Sign in via Cursor Settings, then reload the window.'
      );
    }

    if (!isTokenExpired(fromDb.accessToken)) {
      extensionLog.debug(
        '[TokenService] Loaded valid tokens from active profile state database'
      );
      await this.persistTokens(fromDb, profileSecrets);
      return fromDb;
    }

    const fromProfileSecrets = await this.readFromSecrets(profileSecrets);
    if (
      fromProfileSecrets?.accessToken &&
      !isTokenExpired(fromProfileSecrets.accessToken)
    ) {
      extensionLog.debug(
        '[TokenService] Using refreshed access token from profile-scoped secrets'
      );
      return {
        ...fromProfileSecrets,
        email: fromDb.email ?? fromProfileSecrets.email,
      };
    }

    let refreshToken = fromDb.refreshToken;
    if (!refreshToken) {
      refreshToken =
        fromProfileSecrets?.refreshToken ??
        (await this.readFromSecrets(SECRETS_KEYS))?.refreshToken;
    }

    if (!refreshToken) {
      throw new Error(
        'Cursor session expired. Sign in again via Cursor Settings.'
      );
    }

    extensionLog.debug('[TokenService] Access token expired; refreshing via OAuth');
    const refreshed = await this.refreshTokens(refreshToken, profileSecrets, signal);
    return { ...refreshed, email: fromDb.email ?? refreshed.email };
  }

  private async readFromSecrets(keys: {
    accessToken: string;
    refreshToken: string;
  }): Promise<CursorAuthTokens | null> {
    const accessToken = await this.context.secrets.get(keys.accessToken);
    if (!accessToken) {
      return null;
    }
    const refreshToken = await this.context.secrets.get(keys.refreshToken);
    return { accessToken, refreshToken };
  }

  private async persistTokens(
    tokens: CursorAuthTokens,
    keys: { accessToken: string; refreshToken: string }
  ): Promise<void> {
    await this.context.secrets.store(keys.accessToken, tokens.accessToken);
    if (tokens.refreshToken) {
      await this.context.secrets.store(keys.refreshToken, tokens.refreshToken);
    }
  }

  async refreshTokens(
    refreshToken: string,
    profileSecrets?: { accessToken: string; refreshToken: string },
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

    const body = parseJsonWithSchema(
      oauthTokenResponseSchema,
      await response.json(),
      'OAuth token response'
    );

    if (!response.ok || !body.access_token) {
      const detail =
        body.error_description ?? body.error ?? response.statusText;
      extensionLog.error(`[TokenService] Token refresh failed: ${detail}`);
      throw new Error(`Token refresh failed: ${detail}`);
    }

    const tokens: CursorAuthTokens = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? refreshToken,
    };

    const secretsKeys =
      profileSecrets ??
      getProfileSecretsKeys(this.profileDetector.getCurrentUserDataDir());
    await this.persistTokens(tokens, secretsKeys);
    extensionLog.info('[TokenService] OAuth token refresh succeeded');
    return tokens;
  }
}
