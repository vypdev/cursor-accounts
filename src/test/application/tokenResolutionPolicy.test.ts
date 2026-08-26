import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveTokenResolution,
  type StoredAuthTokens,
} from '../../application/services/tokenResolutionPolicy';

const validAccess = (accessToken: string): boolean => accessToken === 'valid';

function resolve(
  stateDb: StoredAuthTokens | null,
  profileSecrets: StoredAuthTokens | null = null,
  legacySecrets: StoredAuthTokens | null = null
) {
  return resolveTokenResolution({
    stateDb,
    profileSecrets,
    legacySecrets,
    isAccessTokenValid: validAccess,
  });
}

describe('token resolution policy', () => {
  it('uses valid profile secrets when the state database has no access token', () => {
    assert.deepEqual(
      resolve(null, {
        accessToken: 'valid',
        refreshToken: 'profile-refresh',
      }),
      {
        kind: 'use',
        source: 'profile-secrets',
        tokens: { accessToken: 'valid', refreshToken: 'profile-refresh' },
        persistToProfileSecrets: false,
      }
    );
  });

  it('falls back to valid legacy secrets when profile secrets are unavailable', () => {
    assert.deepEqual(
      resolve(null, { accessToken: 'expired' }, {
        accessToken: 'valid',
        refreshToken: 'legacy-refresh',
      }),
      {
        kind: 'use',
        source: 'legacy-secrets',
        tokens: { accessToken: 'valid', refreshToken: 'legacy-refresh' },
        persistToProfileSecrets: false,
      }
    );
  });

  it('refreshes from profile secrets even when only the refresh token remains', () => {
    assert.deepEqual(resolve(null, { refreshToken: 'profile-refresh' }), {
      kind: 'refresh',
      source: 'profile-secrets',
      refreshToken: 'profile-refresh',
    });
  });

  it('uses a valid state database token and requests profile persistence', () => {
    assert.deepEqual(
      resolve({
        accessToken: 'valid',
        refreshToken: 'state-refresh',
        email: 'state@example.com',
      }),
      {
        kind: 'use',
        source: 'state-db',
        tokens: {
          accessToken: 'valid',
          refreshToken: 'state-refresh',
          email: 'state@example.com',
        },
        persistToProfileSecrets: true,
      }
    );
  });

  it('uses a refreshed profile access token and preserves the state email', () => {
    assert.deepEqual(
      resolve(
        { accessToken: 'expired', email: 'state@example.com' },
        { accessToken: 'valid', refreshToken: 'profile-refresh', email: 'old@example.com' }
      ),
      {
        kind: 'use',
        source: 'profile-secrets',
        tokens: {
          accessToken: 'valid',
          refreshToken: 'profile-refresh',
          email: 'state@example.com',
        },
        persistToProfileSecrets: false,
      }
    );
  });

  it('prefers state, then profile, then legacy refresh tokens after expiry', () => {
    assert.deepEqual(
      resolve(
        { accessToken: 'expired', refreshToken: 'state-refresh', email: 'state@example.com' },
        { refreshToken: 'profile-refresh' },
        { refreshToken: 'legacy-refresh' }
      ),
      {
        kind: 'refresh',
        source: 'state-db',
        refreshToken: 'state-refresh',
        email: 'state@example.com',
      }
    );
    assert.deepEqual(
      resolve({ accessToken: 'expired' }, { refreshToken: 'profile-refresh' }, {
        refreshToken: 'legacy-refresh',
      }),
      {
        kind: 'refresh',
        source: 'profile-secrets',
        refreshToken: 'profile-refresh',
      }
    );
  });

  it('returns distinct terminal states for missing and expired sessions', () => {
    assert.deepEqual(resolve(null), { kind: 'not-signed-in' });
    assert.deepEqual(resolve({ accessToken: 'expired' }), {
      kind: 'session-expired',
    });
  });
});
