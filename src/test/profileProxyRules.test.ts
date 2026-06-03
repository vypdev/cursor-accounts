import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isProfileProxyEnabled } from '@cursor-accounts/types';

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
