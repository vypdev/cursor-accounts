import type { CursorAuthTokens } from '@cursor-accounts/types';

/** Token material read from one persisted authentication source. */
export interface StoredAuthTokens {
  accessToken?: string;
  refreshToken?: string;
  email?: string;
}

export type TokenSource = 'state-db' | 'profile-secrets' | 'legacy-secrets';

export type TokenResolution =
  | {
      kind: 'use';
      source: TokenSource;
      tokens: CursorAuthTokens;
      persistToProfileSecrets: boolean;
    }
  | {
      kind: 'refresh';
      source: TokenSource;
      refreshToken: string;
      email?: string;
    }
  | { kind: 'not-signed-in' }
  | { kind: 'session-expired' };

export interface TokenResolutionInput {
  stateDb: StoredAuthTokens | null;
  profileSecrets: StoredAuthTokens | null;
  legacySecrets: StoredAuthTokens | null;
  isAccessTokenValid: (accessToken: string) => boolean;
}

/**
 * Select the active authentication source without performing I/O.
 *
 * The state database is authoritative when its access token is valid. When
 * it is missing or expired, profile-scoped secrets take precedence over the
 * legacy global secret namespace, and a refresh token is the final recovery
 * path. The caller owns reading, refreshing, and persisting credentials.
 */
export function resolveTokenResolution(
  input: TokenResolutionInput
): TokenResolution {
  const { stateDb, profileSecrets, legacySecrets, isAccessTokenValid } = input;

  if (!stateDb?.accessToken) {
    const profileTokens = getValidTokens(profileSecrets, isAccessTokenValid);
    if (profileTokens) {
      return {
        kind: 'use',
        source: 'profile-secrets',
        tokens: profileTokens,
        persistToProfileSecrets: false,
      };
    }

    const legacyTokens = getValidTokens(legacySecrets, isAccessTokenValid);
    if (legacyTokens) {
      return {
        kind: 'use',
        source: 'legacy-secrets',
        tokens: legacyTokens,
        persistToProfileSecrets: false,
      };
    }

    const refreshToken = profileSecrets?.refreshToken ?? legacySecrets?.refreshToken;
    if (refreshToken) {
      return {
        kind: 'refresh',
        source: profileSecrets?.refreshToken
          ? 'profile-secrets'
          : 'legacy-secrets',
        refreshToken,
      };
    }

    return { kind: 'not-signed-in' };
  }

  if (isAccessTokenValid(stateDb.accessToken)) {
    return {
      kind: 'use',
      source: 'state-db',
      tokens: toAuthTokens(stateDb),
      persistToProfileSecrets: true,
    };
  }

  const profileTokens = getValidTokens(profileSecrets, isAccessTokenValid);
  if (profileTokens) {
    const email = stateDb.email ?? profileTokens.email;
    return {
      kind: 'use',
      source: 'profile-secrets',
      tokens: {
        ...profileTokens,
        ...(email === undefined ? {} : { email }),
      },
      persistToProfileSecrets: false,
    };
  }

  const refreshToken =
    stateDb.refreshToken ??
    profileSecrets?.refreshToken ??
    legacySecrets?.refreshToken;
  if (refreshToken) {
    return {
      kind: 'refresh',
      source: stateDb.refreshToken
        ? 'state-db'
        : profileSecrets?.refreshToken
          ? 'profile-secrets'
          : 'legacy-secrets',
      refreshToken,
      ...(stateDb.email === undefined ? {} : { email: stateDb.email }),
    };
  }

  return { kind: 'session-expired' };
}

function getValidTokens(
  storedTokens: StoredAuthTokens | null,
  isAccessTokenValid: (accessToken: string) => boolean
): CursorAuthTokens | undefined {
  if (!storedTokens?.accessToken || !isAccessTokenValid(storedTokens.accessToken)) {
    return undefined;
  }
  return toAuthTokens(storedTokens);
}

function toAuthTokens(storedTokens: StoredAuthTokens): CursorAuthTokens {
  if (!storedTokens.accessToken) {
    throw new Error('Cannot create authentication tokens without an access token');
  }
  const tokens: CursorAuthTokens = {
    accessToken: storedTokens.accessToken,
  };
  if (storedTokens.refreshToken !== undefined) {
    tokens.refreshToken = storedTokens.refreshToken;
  }
  if (storedTokens.email !== undefined) {
    tokens.email = storedTokens.email;
  }
  return tokens;
}
