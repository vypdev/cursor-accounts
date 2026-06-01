import type { CursorAuthTokens } from '@cursor-accounts/types';

/** Reads authentication tokens from a profile's Cursor state database. */
export interface IProfileAuthReader {
  /** Load tokens for the given profile user data directory. */
  readTokens(userDataDir: string): Promise<CursorAuthTokens | null>;
}
