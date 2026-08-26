import type * as vscode from 'vscode';
import type { CursorAuthTokens } from '@cursor-accounts/types';
import type { IRefreshableTokenProvider } from '../domain/ports/ITokenProvider';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IOAuthTokenClient } from '../domain/ports/IOAuthTokenClient';
import * as extensionLog from '../logging/extensionLog';
import {
  getProfileSecretsKeys,
  getProfileStateDbPath,
  SECRETS_KEYS,
} from './cursorPaths';
import { isTokenExpired, readAuthFromStateDb } from './tokenReader';
import {
  resolveTokenResolution,
  type StoredAuthTokens,
} from '../application/services/tokenResolutionPolicy';
import { OAuthTokenClient } from './oauthTokenClient';

export interface TokenServiceDependencies {
  oauthTokenClient?: IOAuthTokenClient;
}

export class TokenService implements IRefreshableTokenProvider {
  private readonly extensionPath: string;
  private readonly oauthTokenClient: IOAuthTokenClient;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileDetector: IProfileDetector,
    dependencies: TokenServiceDependencies = {}
  ) {
    this.extensionPath = context.extensionPath;
    this.oauthTokenClient =
      dependencies.oauthTokenClient ?? new OAuthTokenClient();
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
    const needsSecretFallback =
      !fromDb?.accessToken || isTokenExpired(fromDb.accessToken);
    const fromProfileSecrets = needsSecretFallback
      ? await this.readFromSecrets(profileSecrets)
      : null;
    const legacySecrets = needsSecretFallback
      ? await this.readFromSecrets(SECRETS_KEYS)
      : null;
    const resolution = resolveTokenResolution({
      stateDb: fromDb,
      profileSecrets: fromProfileSecrets,
      legacySecrets,
      isAccessTokenValid: (accessToken) => !isTokenExpired(accessToken),
    });

    if (resolution.kind === 'use') {
      extensionLog.debug(this.describeTokenSource(resolution.source));
      if (resolution.persistToProfileSecrets) {
        await this.persistTokens(resolution.tokens, profileSecrets);
      }
      return resolution.tokens;
    }

    if (resolution.kind === 'refresh') {
      extensionLog.debug(
        `[TokenService] Refreshing expired or unavailable access token from ${resolution.source}`
      );
      const refreshed = await this.refreshTokens(
        resolution.refreshToken,
        profileSecrets,
        signal
      );
      const email = resolution.email ?? refreshed.email;
      return email === undefined ? refreshed : { ...refreshed, email };
    }

    if (resolution.kind === 'not-signed-in') {
      throw new Error(
        'Cursor is not signed in. Sign in via Cursor Settings, then reload the window.'
      );
    }

    throw new Error('Cursor session expired. Sign in again via Cursor Settings.');
  }

  private async readFromSecrets(keys: {
    accessToken: string;
    refreshToken: string;
  }): Promise<StoredAuthTokens | null> {
    const accessToken = await this.context.secrets.get(keys.accessToken);
    const refreshToken = await this.context.secrets.get(keys.refreshToken);
    if (!accessToken && !refreshToken) {
      return null;
    }
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
    const tokens = await this.oauthTokenClient.refreshTokens(refreshToken, signal);

    const secretsKeys =
      profileSecrets ??
      getProfileSecretsKeys(this.profileDetector.getCurrentUserDataDir());
    await this.persistTokens(tokens, secretsKeys);
    extensionLog.info('[TokenService] OAuth token refresh succeeded');
    return tokens;
  }

  private describeTokenSource(
    source: 'state-db' | 'profile-secrets' | 'legacy-secrets'
  ): string {
    switch (source) {
      case 'state-db':
        return '[TokenService] Loaded valid tokens from active profile state database';
      case 'profile-secrets':
        return '[TokenService] Using valid access token from profile-scoped secrets';
      case 'legacy-secrets':
        return '[TokenService] Using access token from legacy global secrets';
    }
  }
}
