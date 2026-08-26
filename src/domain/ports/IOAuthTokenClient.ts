import type { CursorAuthTokens } from '@cursor-accounts/types';

/** Port for exchanging a Cursor OAuth refresh token for access credentials. */
export interface IOAuthTokenClient {
  refreshTokens(
    refreshToken: string,
    signal?: AbortSignal
  ): Promise<CursorAuthTokens>;
}
