import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CursorAuthTokens } from '@cursor-accounts/types';
import type { ResolveValidTokensUseCaseDependencies } from '../../application/services/resolveValidTokensUseCase';
import { ResolveValidTokensUseCase } from '../../application/services/resolveValidTokensUseCase';

const PROFILE_KEYS = {
  accessToken: 'profile.access',
  refreshToken: 'profile.refresh',
};

const LEGACY_KEYS = {
  accessToken: 'legacy.access',
  refreshToken: 'legacy.refresh',
};

function createDependencies(
  overrides: Partial<ResolveValidTokensUseCaseDependencies> = {}
): ResolveValidTokensUseCaseDependencies & {
  values: Map<string, string>;
  logs: string[];
} {
  const values = new Map<string, string>();
  const logs: string[] = [];
  const dependencies: ResolveValidTokensUseCaseDependencies = {
    profileAuthReader: {
      readTokens: async () => null,
    },
    secrets: {
      get: async (key) => values.get(key),
      store: async (key, value) => {
        values.set(key, value);
      },
    },
    getProfileSecretsKeys: () => PROFILE_KEYS,
    legacySecretKeys: LEGACY_KEYS,
    oauthTokenClient: {
      refreshTokens: async (refreshToken) => ({
        accessToken: `refreshed-${refreshToken}`,
        refreshToken,
      }),
    },
    isAccessTokenValid: (accessToken) => accessToken === 'valid',
    logDebug: (message) => {
      logs.push(`debug:${message}`);
    },
    logInfo: (message) => {
      logs.push(`info:${message}`);
    },
    ...overrides,
  };
  return Object.assign(dependencies, { values, logs });
}

describe('ResolveValidTokensUseCase', () => {
  it('uses valid state-database tokens and persists them to profile secrets', async () => {
    const dependencies = createDependencies({
      profileAuthReader: {
        readTokens: async () => ({
          accessToken: 'valid',
          refreshToken: 'state-refresh',
          email: 'state@example.com',
        }),
      },
    });

    const tokens = await new ResolveValidTokensUseCase(dependencies).execute(
      '/tmp/profile-1'
    );

    assert.deepEqual(tokens, {
      accessToken: 'valid',
      refreshToken: 'state-refresh',
      email: 'state@example.com',
    });
    assert.equal(dependencies.values.get(PROFILE_KEYS.accessToken), 'valid');
    assert.equal(
      dependencies.values.get(PROFILE_KEYS.refreshToken),
      'state-refresh'
    );
    assert.match(dependencies.logs[0] ?? '', /state database/);
  });

  it('uses valid profile secrets when the state database access token is expired', async () => {
    const dependencies = createDependencies({
      profileAuthReader: {
        readTokens: async () => ({ accessToken: 'expired' }),
      },
    });
    dependencies.values.set(PROFILE_KEYS.accessToken, 'valid');
    dependencies.values.set(PROFILE_KEYS.refreshToken, 'profile-refresh');

    const tokens = await new ResolveValidTokensUseCase(dependencies).execute(
      '/tmp/profile-1'
    );

    assert.deepEqual(tokens, {
      accessToken: 'valid',
      refreshToken: 'profile-refresh',
    });
    assert.equal(
      dependencies.logs.some((message) => message.includes('profile-scoped')),
      true
    );
  });

  it('refreshes profile credentials, forwards the signal, and preserves state email', async () => {
    const dependencies = createDependencies({
      profileAuthReader: {
        readTokens: async () => ({
          accessToken: 'expired',
          email: 'state@example.com',
        }),
      },
    });
    dependencies.values.set(PROFILE_KEYS.refreshToken, 'profile-refresh');
    const signal = new AbortController().signal;
    let receivedSignal: AbortSignal | undefined;
    dependencies.oauthTokenClient = {
      refreshTokens: async (_refreshToken, forwardedSignal) => {
        receivedSignal = forwardedSignal;
        return {
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          email: 'oauth@example.com',
        };
      },
    };

    const tokens = await new ResolveValidTokensUseCase(dependencies).execute(
      '/tmp/profile-1',
      signal
    );

    assert.deepEqual(tokens, {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      email: 'state@example.com',
    });
    assert.equal(receivedSignal, signal);
    assert.equal(dependencies.values.get(PROFILE_KEYS.accessToken), 'new-access');
    assert.equal(
      dependencies.values.get(PROFILE_KEYS.refreshToken),
      'new-refresh'
    );
  });

  it('falls back to legacy secrets without persisting them to profile scope', async () => {
    const dependencies = createDependencies();
    dependencies.values.set(LEGACY_KEYS.accessToken, 'valid');
    dependencies.values.set(LEGACY_KEYS.refreshToken, 'legacy-refresh');

    const tokens = await new ResolveValidTokensUseCase(dependencies).execute(
      '/tmp/profile-1'
    );

    assert.deepEqual(tokens, {
      accessToken: 'valid',
      refreshToken: 'legacy-refresh',
    });
    assert.equal(dependencies.values.has(PROFILE_KEYS.accessToken), false);
  });

  it('exposes distinct terminal errors for missing and expired sessions', async () => {
    const notSignedIn = createDependencies();
    await assert.rejects(
      () => new ResolveValidTokensUseCase(notSignedIn).execute('/tmp/profile-1'),
      /Cursor is not signed in/
    );

    const expired = createDependencies({
      profileAuthReader: {
        readTokens: async () => ({ accessToken: 'expired' }),
      },
    });
    await assert.rejects(
      () => new ResolveValidTokensUseCase(expired).execute('/tmp/profile-1'),
      /Cursor session expired/
    );
  });

  it('refreshes directly through the OAuth port and stores returned credentials', async () => {
    const dependencies = createDependencies();
    const tokens: CursorAuthTokens = {
      accessToken: 'direct-access',
      refreshToken: 'direct-refresh',
    };
    dependencies.oauthTokenClient = {
      refreshTokens: async () => tokens,
    };

    const result = await new ResolveValidTokensUseCase(dependencies).refreshTokens(
      'old-refresh',
      PROFILE_KEYS
    );

    assert.deepEqual(result, tokens);
    assert.equal(dependencies.values.get(PROFILE_KEYS.accessToken), 'direct-access');
    assert.equal(dependencies.values.get(PROFILE_KEYS.refreshToken), 'direct-refresh');
    assert.equal(
      dependencies.logs.includes('info:[TokenService] OAuth token refresh succeeded'),
      true
    );
  });
});
