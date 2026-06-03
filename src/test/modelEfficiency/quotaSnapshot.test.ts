import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildQuotaFieldsFromProfileQuota,
  parseBillingCycleEpoch,
} from '../../modelEfficiency/quotaSnapshot';

describe('quotaSnapshot', () => {
  it('parses ISO and epoch billing cycle values', () => {
    const iso = parseBillingCycleEpoch('2026-01-15T00:00:00.000Z');
    assert.ok(iso && iso > 0);

    const ms = parseBillingCycleEpoch('1700000000000');
    assert.equal(ms, 1_700_000_000);
  });

  it('builds quota fields from profile quota', () => {
    const fields = buildQuotaFieldsFromProfileQuota({
      profileId: 'p1',
      fetchedAt: Date.now(),
      quota: {
        totalPercentUsed: 42,
        autoPercentUsed: 40,
        apiPercentUsed: 44,
        totalSpend: 0,
        includedSpend: 0,
        remaining: 100,
        limit: 40000,
        billingCycleStart: '1700000000000',
        billingCycleEnd: '2026-02-01T00:00:00.000Z',
        fetchedAt: Date.now(),
        membershipType: 'enterprise',
        limitType: 'team',
      },
    });

    assert.equal(fields.quotaPercentUsed, 42);
    assert.equal(fields.quotaIsEnterprise, true);
    assert.ok(fields.quotaCycleStart);
    assert.ok(fields.quotaCycleEnd);
  });
});
