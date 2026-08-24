import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import {
  isValidApiToken,
  localhostOnly,
} from '../../../proxy/api/middleware/localhostValidator';

function request(remoteAddress: string | undefined, forwardedFor?: string): Request {
  return {
    socket: { remoteAddress },
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
  } as unknown as Request;
}

function response() {
  let statusCode = 200;
  let body: unknown;
  const value = {
    status(code: number) {
      statusCode = code;
      return value;
    },
    json(payload: unknown) {
      body = payload;
      return value;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  } as unknown as Response & { readonly statusCode: number; readonly body: unknown };
  return value;
}

describe('localhostValidator', () => {
  it('accepts loopback socket addresses', () => {
    const res = response();
    let nextCalled = false;

    localhostOnly(request('127.0.0.1'), res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  });

  it('does not trust forwarded headers to grant remote access', () => {
    const res = response();

    localhostOnly(request('10.0.0.4', '127.0.0.1'), res, () => undefined);

    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Forbidden: localhost only' });
  });

  it('compares capability tokens in constant-time after length validation', () => {
    const token = 'a'.repeat(64);

    assert.equal(isValidApiToken(`Bearer ${token}`, token), true);
    assert.equal(isValidApiToken(`Bearer ${'b'.repeat(64)}`, token), false);
    assert.equal(isValidApiToken('Bearer short', token), false);
    assert.equal(isValidApiToken(undefined, undefined), true);
  });
});
