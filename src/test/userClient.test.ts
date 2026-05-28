import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkosSessionCookie,
  mapAccountInfoResponse,
} from '../api/userClient';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString(
    'base64url'
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('buildWorkosSessionCookie', () => {
  it('extracts userId from pipe-delimited sub claim', () => {
    const token = makeJwt({ sub: 'github|user_01JN639M0Z1R9BH9Q1A6NK46TZ' });
    const cookie = buildWorkosSessionCookie(token);
    assert.equal(
      cookie,
      `WorkosCursorSessionToken=user_01JN639M0Z1R9BH9Q1A6NK46TZ%3A%3A${token}`
    );
  });

  it('uses sub directly when no pipe separator', () => {
    const token = makeJwt({ sub: 'user_abc123' });
    const cookie = buildWorkosSessionCookie(token);
    assert.equal(cookie, `WorkosCursorSessionToken=user_abc123%3A%3A${token}`);
  });

  it('throws when sub claim is missing', () => {
    const token = makeJwt({ aud: 'test' });
    assert.throws(() => buildWorkosSessionCookie(token), /missing sub/i);
  });
});

describe('mapAccountInfoResponse', () => {
  it('maps name and picture from API shape', () => {
    const mapped = mapAccountInfoResponse({
      email: 'user@example.com',
      name: 'Test User',
      picture: 'https://workoscdn.com/images/v1/abc',
      sub: 'user_123',
      id: 42,
    });

    assert.equal(mapped.name, 'Test User');
    assert.equal(mapped.picture, 'https://workoscdn.com/images/v1/abc');
    assert.equal(mapped.email, 'user@example.com');
  });
});
