import { describe, it, expect } from 'vitest';
import {
  formatCompactNumber,
  getQuotaStatus,
  getEffectiveUsagePercent,
} from '../types';

describe('quota display helpers', () => {
  it('formats compact numbers', () => {
    expect(formatCompactNumber(456728)).toBe('457k');
    expect(formatCompactNumber(0)).toBe('0');
  });

  it('derives quota status from usage percent', () => {
    expect(
      getQuotaStatus({
        totalPercentUsed: 96,
        autoPercentUsed: 96,
        apiPercentUsed: 96,
        totalSpend: 0,
        includedSpend: 0,
        remaining: 0,
        limit: 100,
        billingCycleStart: '0',
        billingCycleEnd: '0',
        fetchedAt: Date.now(),
        displayMode: 'percent',
      })
    ).toBe('critical');
  });

  it('computes effective usage percent for monthly spend mode', () => {
    expect(
      getEffectiveUsagePercent({
        totalPercentUsed: 0,
        autoPercentUsed: 0,
        apiPercentUsed: 0,
        totalSpend: 0,
        includedSpend: 0,
        remaining: 0,
        limit: 0,
        billingCycleStart: '0',
        billingCycleEnd: '0',
        fetchedAt: Date.now(),
        displayMode: 'monthlySpend',
        monthlySpend: 2500,
        monthlyLimit: 5000,
      })
    ).toBe(50);
  });
});
