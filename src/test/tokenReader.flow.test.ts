import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTokenExpired, parseStoredValue } from '../auth/tokenReader';

describe('tokenReader', () => {
  it('parseStoredValue unwraps JSON-encoded strings', () => {
    const parsed = parseStoredValue('"access-token"');
    assert.equal(parsed, 'access-token');
  });

  it('isTokenExpired treats malformed token as not expired when exp missing', () => {
    assert.equal(isTokenExpired('not-a-jwt'), false);
  });
});
