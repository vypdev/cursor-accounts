import { CursorAuthTokens } from '../api/types';

/** Abstraction for obtaining valid auth tokens (current window or static profile tokens). */
export interface TokenProvider {
  getValidTokens(signal?: AbortSignal): Promise<CursorAuthTokens>;
}

/** Token provider that returns pre-loaded tokens without refresh (for other profiles). */
export class StaticTokenProvider implements TokenProvider {
  constructor(private readonly tokens: CursorAuthTokens) {}

  async getValidTokens(): Promise<CursorAuthTokens> {
    return this.tokens;
  }
}
