import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isProfileProxyEnabled,
  isProfileProxyJsonlLoggingEnabled,
} from '@cursor-accounts/types';

describe('isProfileProxyEnabled', () => {
  it('returns true when proxyEnabled is undefined', () => {
    assert.equal(isProfileProxyEnabled({}), true);
  });

  it('returns true when proxyEnabled is true', () => {
    assert.equal(isProfileProxyEnabled({ proxyEnabled: true }), true);
  });

  it('returns false when proxyEnabled is false', () => {
    assert.equal(isProfileProxyEnabled({ proxyEnabled: false }), false);
  });
});

describe('isProfileProxyJsonlLoggingEnabled', () => {
  it('returns false when proxyJsonlLoggingEnabled is undefined', () => {
    assert.equal(isProfileProxyJsonlLoggingEnabled({}), false);
  });

  it('returns false when proxyJsonlLoggingEnabled is false', () => {
    assert.equal(isProfileProxyJsonlLoggingEnabled({ proxyJsonlLoggingEnabled: false }), false);
  });

  it('returns true when proxyJsonlLoggingEnabled is true', () => {
    assert.equal(isProfileProxyJsonlLoggingEnabled({ proxyJsonlLoggingEnabled: true }), true);
  });
});
