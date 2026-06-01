import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapUsageResponse, mergeWebUsage } from '../api/quotaClient';
import { mapUsageSummaryResponse } from '../api/usageSummaryClient';
import type { QuotaUsage } from '../api/types';

describe('mapUsageResponse', () => {
  it('maps plan usage and billing cycle from API shape', () => {
    const usage = mapUsageResponse(
      {
        billingCycleStart: '1768399334000',
        billingCycleEnd: '1771077734000',
        planUsage: {
          totalSpend: 23222,
          includedSpend: 23222,
          remaining: 16778,
          limit: 40000,
          autoPercentUsed: 0,
          apiPercentUsed: 46.444,
          totalPercentUsed: 15.48,
        },
        displayMessage: "You've used 46% of your usage limit",
      },
      'user@example.com'
    );

    assert.equal(usage.apiPercentUsed, 46.444);
    assert.equal(usage.totalPercentUsed, 15.48);
    assert.equal(usage.limit, 40000);
    assert.equal(usage.billingCycleStart, '1768399334000');
    assert.equal(usage.accountEmail, 'user@example.com');
    assert.equal(usage.displayMessage, "You've used 46% of your usage limit");
    assert.equal(usage.displayMode, 'percent');
    assert.ok(usage.fetchedAt > 0);
  });

  it('maps spendLimitUsage for team monthly spend mode', () => {
    const usage = mapUsageResponse({
      billingCycleStart: '1768399334000',
      billingCycleEnd: '1771077734000',
      planUsage: {
        totalPercentUsed: 0,
        limit: 0,
      },
      spendLimitUsage: {
        limitType: 'team',
        pooledUsed: 9400,
        pooledLimit: 60000,
        pooledRemaining: 50600,
      },
    });

    assert.equal(usage.displayMode, 'monthlySpend');
    assert.equal(usage.monthlySpend, 9400);
    assert.equal(usage.monthlyLimit, 60000);
    assert.ok(Math.abs(usage.totalPercentUsed - 15.67) < 0.1);
  });

  it('defaults missing planUsage fields to zero', () => {
    const usage = mapUsageResponse({});
    assert.equal(usage.totalPercentUsed, 0);
    assert.equal(usage.autoPercentUsed, 0);
    assert.equal(usage.apiPercentUsed, 0);
  });
});

describe('mergeWebUsage', () => {
  const ideUsage: QuotaUsage = {
    totalPercentUsed: 0,
    autoPercentUsed: 0,
    apiPercentUsed: 0,
    totalSpend: 0,
    includedSpend: 0,
    remaining: 0,
    limit: 0,
    billingCycleStart: '1768399334000',
    billingCycleEnd: '1768399334000',
    fetchedAt: 1,
    displayMode: 'percent',
    dataSource: 'ide',
  };

  it('prefers web spend fields for enterprise even when IDE has billing dates only', () => {
    const webUsage: QuotaUsage = {
      ...ideUsage,
      membershipType: 'enterprise',
      limitType: 'team',
      displayMode: 'monthlySpend',
      monthlySpend: 9400,
      monthlyLimit: 60000,
      totalPercentUsed: 15.67,
      billingCycleEnd: '2026-05-02T14:11:55.000Z',
      dataSource: 'web',
    };

    const merged = mergeWebUsage(ideUsage, webUsage);

    assert.equal(merged.displayMode, 'monthlySpend');
    assert.equal(merged.monthlySpend, 9400);
    assert.equal(merged.monthlyLimit, 60000);
    assert.ok(Math.abs(merged.totalPercentUsed - 15.67) < 0.1);
    assert.equal(merged.billingCycleEnd, '2026-05-02T14:11:55.000Z');
  });

  it('merges production enterprise overall web usage over empty IDE response', () => {
    const webUsage = mapUsageSummaryResponse({
      billingCycleEnd: '2026-06-01T00:00:00.000Z',
      membershipType: 'enterprise',
      limitType: 'team',
      individualUsage: {
        overall: { used: 9461, limit: 60000, remaining: 50539 },
      },
    });

    const merged = mergeWebUsage(ideUsage, webUsage);

    assert.equal(merged.monthlySpend, 9461);
    assert.equal(merged.monthlyLimit, 60000);
    assert.ok(Math.abs(merged.totalPercentUsed - 15.77) < 0.1);
    assert.equal(merged.billingCycleEnd, '2026-06-01T00:00:00.000Z');
  });

  it('keeps IDE percent usage when web response is non-enterprise percent mode', () => {
    const webUsage: QuotaUsage = {
      ...ideUsage,
      membershipType: 'pro',
      billingCycleEnd: '2026-05-02T14:11:55.000Z',
      displayMode: 'percent',
      dataSource: 'web',
    };

    const merged = mergeWebUsage(
      { ...ideUsage, totalPercentUsed: 42, limit: 100 },
      webUsage
    );

    assert.equal(merged.totalPercentUsed, 42);
    assert.equal(merged.billingCycleEnd, '2026-05-02T14:11:55.000Z');
  });
});
