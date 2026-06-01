import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getEffectiveUsagePercent,
  getPersonalModeAveragePercent,
  getQuotaStatus,
  isEnterpriseUsage,
} from '@cursor-accounts/types';
import type { QuotaUsage } from '@cursor-accounts/types';

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

describe('domain quota rules', () => {
  it('computes personal mode average percent', () => {
    const quota = makePersonalQuota({
      apiPercentUsed: 46.4,
      autoPercentUsed: 30.2,
    });
    assert.equal(getPersonalModeAveragePercent(quota), 38);
  });

  it('computes monthly spend effective percent', () => {
    const quota = makePersonalQuota({
      displayMode: 'monthlySpend',
      monthlySpend: 3000,
      monthlyLimit: 6000,
      totalPercentUsed: 0,
    });
    assert.equal(getEffectiveUsagePercent(quota), 50);
  });

  it('returns critical status above 95%', () => {
    assert.equal(
      getQuotaStatus(
        makePersonalQuota({
          apiPercentUsed: 96,
          autoPercentUsed: 96,
          totalPercentUsed: 96,
        })
      ),
      'critical'
    );
  });

  it('detects enterprise usage', () => {
    assert.equal(
      isEnterpriseUsage(makePersonalQuota({ membershipType: 'enterprise' })),
      true
    );
  });
});
