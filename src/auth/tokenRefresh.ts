import type * as vscode from 'vscode';
import type { CursorAuthTokens } from '@cursor-accounts/types';
import type { IRefreshableTokenProvider } from '../domain/ports/ITokenProvider';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IOAuthTokenClient } from '../domain/ports/IOAuthTokenClient';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import type { ISecretStorage } from '../domain/ports/ISecretStorage';
import * as extensionLog from '../logging/extensionLog';
import {
  getProfileSecretsKeys,
  getProfileStateDbPath,
  SECRETS_KEYS,
} from './cursorPaths';
import { isTokenExpired } from './tokenReader';
import { OAuthTokenClient } from './oauthTokenClient';
import { ProfileAuthReader } from './profileAuthReader';
import { ResolveValidTokensUseCase } from '../application/services/resolveValidTokensUseCase';

export interface TokenServiceDependencies {
  oauthTokenClient?: IOAuthTokenClient;
  profileAuthReader?: IProfileAuthReader;
  secretStorage?: ISecretStorage;
}

export class TokenService implements IRefreshableTokenProvider {
  private readonly oauthTokenClient: IOAuthTokenClient;
  private readonly resolveValidTokensUseCase: ResolveValidTokensUseCase;

  constructor(
    context: vscode.ExtensionContext,
    private readonly profileDetector: IProfileDetector,
    dependencies: TokenServiceDependencies = {}
  ) {
    this.oauthTokenClient =
      dependencies.oauthTokenClient ?? new OAuthTokenClient();
    this.resolveValidTokensUseCase = new ResolveValidTokensUseCase({
      profileAuthReader:
        dependencies.profileAuthReader ?? new ProfileAuthReader(context),
      secrets: dependencies.secretStorage ?? context.secrets,
      getProfileSecretsKeys,
      legacySecretKeys: SECRETS_KEYS,
      oauthTokenClient: this.oauthTokenClient,
      isAccessTokenValid: (accessToken) => !isTokenExpired(accessToken),
      logDebug: (message) => extensionLog.debug(message),
      logInfo: (message) => extensionLog.info(message),
    });
  }

  /** Resolve state.vscdb for the active Cursor window (respects --user-data-dir). */
  getActiveStateDbPath(): string {
    const userDataDir = this.profileDetector.getCurrentUserDataDir();
    return getProfileStateDbPath(userDataDir);
  }

  async getValidTokens(signal?: AbortSignal): Promise<CursorAuthTokens> {
    const userDataDir = this.profileDetector.getCurrentUserDataDir();
    return this.resolveValidTokensUseCase.execute(userDataDir, signal);
  }

  async refreshTokens(
    refreshToken: string,
    profileSecrets?: { accessToken: string; refreshToken: string },
    signal?: AbortSignal
  ): Promise<CursorAuthTokens> {
    const secretsKeys =
      profileSecrets ??
      getProfileSecretsKeys(this.profileDetector.getCurrentUserDataDir());
    return this.resolveValidTokensUseCase.refreshTokens(
      refreshToken,
      secretsKeys,
      signal
    );
  }

}
