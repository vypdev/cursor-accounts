import type { CursorAuthTokens } from '@cursor-accounts/types';

/** Abstraction for obtaining valid auth tokens (current window or static profile tokens). */
export interface ITokenProvider {
  getValidTokens(signal?: AbortSignal): Promise<CursorAuthTokens>;
}

export interface ProfileSecretKeys {
  accessToken: string;
  refreshToken: string;
}

/** Token provider that can refresh OAuth tokens after a 401. */
export interface IRefreshableTokenProvider extends ITokenProvider {
  refreshTokens(
    refreshToken: string,
    profileSecrets?: ProfileSecretKeys,
    signal?: AbortSignal
  ): Promise<CursorAuthTokens>;
}

export function isRefreshableTokenProvider(
  provider: ITokenProvider
): provider is IRefreshableTokenProvider {
  return typeof (provider as IRefreshableTokenProvider).refreshTokens === 'function';
}
