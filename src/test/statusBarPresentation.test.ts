import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { QuotaUsage } from '@cursor-accounts/types';
import {
  buildQuotaText,
  buildQuotaTooltip,
  getProgressPercent,
  getStatusBarBackground,
} from '../ui/statusBarPresentation';

function usage(overrides: Partial<QuotaUsage> = {}): QuotaUsage {
  return {
    totalPercentUsed: 40,
    autoPercentUsed: 20,
    apiPercentUsed: 60,
    totalSpend: 4000,
    includedSpend: 1000,
    remaining: 6000,
    limit: 10000,
    billingCycleStart: '2026-01-01T00:00:00.000Z',
    billingCycleEnd: '2026-02-01T00:00:00.000Z',
    fetchedAt: 1,
    ...overrides,
  };
}

describe('statusBarPresentation', () => {
  it('uses the average API and auto usage for personal percent accounts', () => {
    const snapshot = usage({ apiPercentUsed: 82, autoPercentUsed: 90 });

    assert.equal(getProgressPercent(snapshot), 86);
    assert.match(buildQuotaText(snapshot, 'Work', true), /86%/);
    assert.match(buildQuotaText(snapshot, 'Work', true), /\(Work\)$/);
  });

  it('uses monthly spend for personal monthly-spend accounts', () => {
    const snapshot = usage({
      displayMode: 'monthlySpend',
      monthlySpend: 2500,
      monthlyLimit: 5000,
    });

    assert.equal(getProgressPercent(snapshot), 50);
    assert.match(buildQuotaText(snapshot, undefined, false), /\$25\.00 \/ \$50\.00/);
  });

  it('uses the effective percent for enterprise monthly-spend accounts', () => {
    const snapshot = usage({
      membershipType: 'enterprise',
      displayMode: 'monthlySpend',
      monthlySpend: 9000,
      monthlyLimit: 10000,
    });

    assert.equal(getProgressPercent(snapshot), 90);
    assert.match(buildQuotaText(snapshot, 'Enterprise', true), /90%/);
    assert.match(buildQuotaText(snapshot, 'Enterprise', true), /\$90\.00 \/ \$100\.00/);
  });

  it('builds a monthly-spend tooltip including email, plan, and team pool', () => {
    const tooltip = buildQuotaTooltip(
      usage({
        displayMode: 'monthlySpend',
        monthlySpend: 2500,
        monthlyLimit: null,
        accountEmail: 'user@example.com',
        membershipType: 'enterprise',
        teamMonthlySpend: 5000,
        teamMonthlyLimit: 10000,
      }),
      true
    );

    assert.match(tooltip, /user@example\.com/);
    assert.match(tooltip, /enterprise/);
    assert.match(tooltip, /\$25\.00 \/ unlimited/);
    assert.match(tooltip, /\$50\.00 \/ \$100\.00/);
  });

  it('builds a percent tooltip and includes an optional display message', () => {
    const tooltip = buildQuotaTooltip(
      usage({ displayMessage: 'Usage is estimated', accountEmail: 'user@example.com' }),
      false
    );

    assert.doesNotMatch(tooltip, /user@example\.com/);
    assert.match(tooltip, /Usage is estimated/);
    assert.match(tooltip, /40%/);
    assert.match(tooltip, /60%/);
  });

  it('maps quota thresholds to status bar background levels', () => {
    assert.equal(getStatusBarBackground(84), undefined);
    assert.equal(getStatusBarBackground(85), 'warning');
    assert.equal(getStatusBarBackground(94), 'warning');
    assert.equal(getStatusBarBackground(95), 'error');
  });
});
