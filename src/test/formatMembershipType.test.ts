import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatMembershipType } from '@cursor-accounts/shared';

describe('formatMembershipType', () => {
  it('returns null for empty values', () => {
    assert.equal(formatMembershipType(undefined), null);
    assert.equal(formatMembershipType('   '), null);
  });

  it('title-cases raw API membership strings', () => {
    assert.equal(formatMembershipType('pro'), 'Pro');
    assert.equal(formatMembershipType('enterprise'), 'Enterprise');
    assert.equal(formatMembershipType('pro_plus'), 'Pro Plus');
    assert.equal(formatMembershipType('ultra'), 'Ultra');
  });
});
