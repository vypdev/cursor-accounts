import type { CursorAuthTokens } from '@cursor-accounts/types';
import type { IProfileAuthReader } from '../../domain/ports/IProfileAuthReader';
import type { IOAuthTokenClient } from '../../domain/ports/IOAuthTokenClient';
import type { ProfileSecretKeys } from '../../domain/ports/ITokenProvider';
import type { ISecretStorage } from '../../domain/ports/ISecretStorage';
import {
  resolveTokenResolution,
  type StoredAuthTokens,
  type TokenSource,
} from './tokenResolutionPolicy';

export interface ResolveValidTokensUseCaseDependencies {
  profileAuthReader: IProfileAuthReader;
  secrets: ISecretStorage;
  getProfileSecretsKeys(userDataDir: string): ProfileSecretKeys;
  legacySecretKeys: ProfileSecretKeys;
  oauthTokenClient: IOAuthTokenClient;
  isAccessTokenValid(accessToken: string): boolean;
  logDebug(message: string): void;
  logInfo(message: string): void;
}

/** Resolves, refreshes, and persists Cursor credentials across auth sources. */
export class ResolveValidTokensUseCase {
  constructor(
    private readonly dependencies: ResolveValidTokensUseCaseDependencies
  ) {}

  async execute(
    userDataDir: string,
    signal?: AbortSignal
  ): Promise<CursorAuthTokens> {
    const profileSecretsKeys = this.dependencies.getProfileSecretsKeys(userDataDir);
    const stateDb = await this.dependencies.profileAuthReader.readTokens(
      userDataDir
    );
    const needsSecretFallback =
      !stateDb?.accessToken ||
      !this.dependencies.isAccessTokenValid(stateDb.accessToken);
    const profileSecrets = needsSecretFallback
      ? await this.readSecrets(profileSecretsKeys)
      : null;
    const legacySecrets = needsSecretFallback
      ? await this.readSecrets(this.dependencies.legacySecretKeys)
      : null;
    const resolution = resolveTokenResolution({
      stateDb,
      profileSecrets,
      legacySecrets,
      isAccessTokenValid: (accessToken) =>
        this.dependencies.isAccessTokenValid(accessToken),
    });

    if (resolution.kind === 'use') {
      this.dependencies.logDebug(this.describeTokenSource(resolution.source));
      if (resolution.persistToProfileSecrets) {
        await this.persistTokens(resolution.tokens, profileSecretsKeys);
      }
      return resolution.tokens;
    }

    if (resolution.kind === 'refresh') {
      this.dependencies.logDebug(
        `[TokenService] Refreshing expired or unavailable access token from ${resolution.source}`
      );
      const refreshed = await this.refreshTokens(
        resolution.refreshToken,
        profileSecretsKeys,
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

  async refreshTokens(
    refreshToken: string,
    profileSecrets: ProfileSecretKeys,
    signal?: AbortSignal
  ): Promise<CursorAuthTokens> {
    const tokens = await this.dependencies.oauthTokenClient.refreshTokens(
      refreshToken,
      signal
    );
    await this.persistTokens(tokens, profileSecrets);
    this.dependencies.logInfo('[TokenService] OAuth token refresh succeeded');
    return tokens;
  }

  private async readSecrets(
    keys: ProfileSecretKeys
  ): Promise<StoredAuthTokens | null> {
    const accessToken = await this.dependencies.secrets.get(keys.accessToken);
    const refreshToken = await this.dependencies.secrets.get(keys.refreshToken);
    if (!accessToken && !refreshToken) {
      return null;
    }
    return { accessToken, refreshToken };
  }

  private async persistTokens(
    tokens: CursorAuthTokens,
    keys: ProfileSecretKeys
  ): Promise<void> {
    await this.dependencies.secrets.store(keys.accessToken, tokens.accessToken);
    if (tokens.refreshToken) {
      await this.dependencies.secrets.store(keys.refreshToken, tokens.refreshToken);
    }
  }

  private describeTokenSource(source: TokenSource): string {
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
