import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPersonalModeAveragePercent,
  isEnterpriseUsage,
  type QuotaUsage,
} from '../api/types';

function makePersonalQuota(
  overrides: Partial<QuotaUsage> = {}
): QuotaUsage {
  return {
    totalPercentUsed: 80,
    autoPercentUsed: 40,
    apiPercentUsed: 60,
    totalSpend: 0,
    includedSpend: 0,
    remaining: 1000,
    limit: 2000,
    billingCycleStart: '0',
    billingCycleEnd: '0',
    fetchedAt: Date.now(),
    membershipType: 'pro',
    limitType: 'user',
    displayMode: 'percent',
    ...overrides,
  };
}

describe('getPersonalModeAveragePercent', () => {
  it('returns rounded average of API and auto mode usage', () => {
    const quota = makePersonalQuota({
      apiPercentUsed: 46.4,
      autoPercentUsed: 30.2,
    });
    assert.equal(getPersonalModeAveragePercent(quota), 38);
  });

  it('returns 0 for null quota', () => {
    assert.equal(getPersonalModeAveragePercent(null), 0);
  });

  it('clamps to 0 and 100', () => {
    assert.equal(
      getPersonalModeAveragePercent(
        makePersonalQuota({ apiPercentUsed: 0, autoPercentUsed: 0 })
      ),
      0
    );
    assert.equal(
      getPersonalModeAveragePercent(
        makePersonalQuota({ apiPercentUsed: 100, autoPercentUsed: 100 })
      ),
      100
    );
    assert.equal(
      getPersonalModeAveragePercent(
        makePersonalQuota({ apiPercentUsed: 200, autoPercentUsed: 200 })
      ),
      100
    );
  });

  it('handles non-finite values as 0', () => {
    assert.equal(
      getPersonalModeAveragePercent(
        makePersonalQuota({
          apiPercentUsed: Number.NaN,
          autoPercentUsed: 50,
        })
      ),
      0
    );
  });
});

describe('isEnterpriseUsage', () => {
  it('detects enterprise membership', () => {
    assert.equal(
      isEnterpriseUsage(makePersonalQuota({ membershipType: 'enterprise' })),
      true
    );
  });
});
