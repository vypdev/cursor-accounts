import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEnterpriseOrTeamSummary,
  mapUsageSummaryResponse,
} from '../api/usageSummaryClient';

describe('mapUsageSummaryResponse', () => {
  it('maps enterprise monthly on-demand spend ($94 / $600)', () => {
    const usage = mapUsageSummaryResponse(
      {
        billingCycleStart: '2026-04-02T14:11:55.000Z',
        billingCycleEnd: '2026-05-02T14:11:55.000Z',
        membershipType: 'enterprise',
        limitType: 'team',
        individualUsage: {
          plan: {
            enabled: true,
            used: 2000,
            limit: 2000,
            totalPercentUsed: 100,
            apiPercentUsed: 100,
          },
          onDemand: {
            enabled: true,
            used: 9400,
            limit: 60000,
            remaining: 50600,
          },
        },
        teamUsage: {
          pooled: {
            enabled: true,
            used: 120000,
            limit: 500000,
            remaining: 380000,
          },
        },
      },
      'enterprise@example.com'
    );

    assert.equal(usage.displayMode, 'monthlySpend');
    assert.equal(usage.monthlySpend, 9400);
    assert.equal(usage.monthlyLimit, 60000);
    assert.equal(usage.remaining, 50600);
    assert.equal(usage.membershipType, 'enterprise');
    assert.equal(usage.limitType, 'team');
    assert.equal(usage.dataSource, 'web');
    assert.equal(usage.billingCycleEnd, '2026-05-02T14:11:55.000Z');
    assert.equal(usage.accountEmail, 'enterprise@example.com');
    assert.ok(Math.abs(usage.totalPercentUsed - 15.67) < 0.1);
    assert.equal(usage.teamMonthlySpend, 120000);
    assert.equal(usage.teamMonthlyLimit, 500000);
  });

  it('forces monthlySpend for enterprise even when onDemand.enabled is false', () => {
    const usage = mapUsageSummaryResponse({
      membershipType: 'enterprise',
      limitType: 'team',
      billingCycleEnd: '2026-05-02T14:11:55.000Z',
      individualUsage: {
        plan: { totalPercentUsed: 0 },
        onDemand: {
          enabled: false,
          used: 9400,
          limit: 60000,
          remaining: 50600,
        },
      },
    });

    assert.equal(usage.displayMode, 'monthlySpend');
    assert.equal(usage.monthlySpend, 9400);
    assert.equal(usage.monthlyLimit, 60000);
    assert.ok(Math.abs(usage.totalPercentUsed - 15.67) < 0.1);
  });

  it('derives monthly limit from used + remaining when limit is null', () => {
    const usage = mapUsageSummaryResponse({
      membershipType: 'enterprise',
      individualUsage: {
        onDemand: {
          enabled: true,
          used: 9400,
          limit: null,
          remaining: 50600,
        },
      },
    });

    assert.equal(usage.monthlyLimit, 60000);
    assert.ok(Math.abs(usage.totalPercentUsed - 15.67) < 0.1);
  });

  it('coerces string numeric values from API', () => {
    const usage = mapUsageSummaryResponse({
      membershipType: 'enterprise',
      individualUsage: {
        onDemand: {
          enabled: true,
          used: '9400',
          limit: '60000',
          remaining: '50600',
        },
      },
    });

    assert.equal(usage.monthlySpend, 9400);
    assert.equal(usage.monthlyLimit, 60000);
    assert.ok(Math.abs(usage.totalPercentUsed - 15.67) < 0.1);
  });

  it('maps production enterprise shape with individualUsage.overall', () => {
    const usage = mapUsageSummaryResponse(
      {
        billingCycleStart: '2026-05-01T00:00:00.000Z',
        billingCycleEnd: '2026-06-01T00:00:00.000Z',
        membershipType: 'enterprise',
        limitType: 'team',
        individualUsage: {
          overall: {
            enabled: true,
            used: 9461,
            limit: 60000,
            remaining: 50539,
          },
        },
        teamUsage: {
          onDemand: { enabled: false, used: 0, limit: null },
          pooled: {
            enabled: true,
            used: 66082797,
            limit: 71168000,
            remaining: 5085203,
          },
        },
      },
      'efrain.espada@feverup.com'
    );

    assert.equal(usage.displayMode, 'monthlySpend');
    assert.equal(usage.monthlySpend, 9461);
    assert.equal(usage.monthlyLimit, 60000);
    assert.equal(usage.remaining, 50539);
    assert.ok(Math.abs(usage.totalPercentUsed - 15.77) < 0.1);
    assert.equal(usage.teamMonthlySpend, 66082797);
    assert.equal(usage.teamMonthlyLimit, 71168000);
  });

  it('prefers overall over onDemand when both are present', () => {
    const usage = mapUsageSummaryResponse({
      membershipType: 'enterprise',
      individualUsage: {
        overall: { used: 9461, limit: 60000, remaining: 50539 },
        onDemand: { used: 100, limit: 200, remaining: 100 },
      },
    });

    assert.equal(usage.monthlySpend, 9461);
    assert.equal(usage.monthlyLimit, 60000);
  });

  it('uses percent mode for pro accounts without on-demand spend', () => {
    const usage = mapUsageSummaryResponse({
      membershipType: 'pro',
      individualUsage: {
        plan: {
          enabled: true,
          used: 100,
          limit: 500,
          totalPercentUsed: 20,
          apiPercentUsed: 20,
        },
        onDemand: {
          enabled: false,
          used: 0,
          limit: null,
        },
      },
    });

    assert.equal(usage.displayMode, 'percent');
    assert.equal(usage.totalPercentUsed, 20);
  });
});

describe('isEnterpriseOrTeamSummary', () => {
  it('detects enterprise membership', () => {
    assert.equal(
      isEnterpriseOrTeamSummary({ membershipType: 'enterprise' }),
      true
    );
  });

  it('detects team limit type', () => {
    assert.equal(isEnterpriseOrTeamSummary({ limitType: 'team' }), true);
  });
});
