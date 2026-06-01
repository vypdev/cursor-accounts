import type { CursorAuthTokens } from '@cursor-accounts/types';
import type { ITokenProvider } from '../domain/ports/ITokenProvider';

export type { ITokenProvider, IRefreshableTokenProvider } from '../domain/ports/ITokenProvider';
export { isRefreshableTokenProvider } from '../domain/ports/ITokenProvider';

/** Token provider that returns pre-loaded tokens without refresh (for other profiles). */
export class StaticTokenProvider implements ITokenProvider {
  constructor(private readonly tokens: CursorAuthTokens) {}

  getValidTokens(): Promise<CursorAuthTokens> {
    return Promise.resolve(this.tokens);
  }
}
