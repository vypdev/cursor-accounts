import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCompactNumber,
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
  describe('getPersonalModeAveragePercent', () => {
    it('computes personal mode average percent', () => {
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

  describe('getEffectiveUsagePercent', () => {
    it('computes monthly spend effective percent', () => {
      const quota = makePersonalQuota({
        displayMode: 'monthlySpend',
        monthlySpend: 3000,
        monthlyLimit: 6000,
        totalPercentUsed: 0,
      });
      assert.equal(getEffectiveUsagePercent(quota), 50);
    });
  });

  describe('getQuotaStatus', () => {
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

    it('returns warning status at 85%', () => {
      assert.equal(
        getQuotaStatus(
          makePersonalQuota({
            apiPercentUsed: 85,
            autoPercentUsed: 85,
            totalPercentUsed: 85,
          })
        ),
        'warning'
      );
    });

    it('returns ok status below 85%', () => {
      assert.equal(
        getQuotaStatus(
          makePersonalQuota({
            apiPercentUsed: 50,
            autoPercentUsed: 50,
            totalPercentUsed: 50,
          })
        ),
        'ok'
      );
    });

    it('returns unavailable for null quota', () => {
      assert.equal(getQuotaStatus(null), 'unavailable');
    });

    it('uses monthly spend threshold for enterprise display mode', () => {
      assert.equal(
        getQuotaStatus(
          makePersonalQuota({
            membershipType: 'enterprise',
            displayMode: 'monthlySpend',
            monthlySpend: 9600,
            monthlyLimit: 10000,
            totalPercentUsed: 96,
          })
        ),
        'critical'
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

    it('detects team limit type', () => {
      assert.equal(
        isEnterpriseUsage(makePersonalQuota({ limitType: 'team' })),
        true
      );
    });
  });

  describe('formatCompactNumber', () => {
    it('formats compact numbers', () => {
      assert.equal(formatCompactNumber(456728), '457k');
      assert.equal(formatCompactNumber(0), '0');
    });
  });
});
