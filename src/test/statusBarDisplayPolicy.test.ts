import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { QuotaUsage } from '../domain';
import {
  resolveStatusBarDisplay,
  type StatusBarDisplayInput,
} from '../ui/statusBarDisplayPolicy';

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

function input(
  overrides: Partial<StatusBarDisplayInput> = {}
): StatusBarDisplayInput {
  return {
    activeProfile: { displayName: 'Work', email: 'work@example.com' },
    cachedUsage: usage(),
    quotaLoading: false,
    showProfileName: true,
    showIncluded: true,
    showTotal: true,
    showAccountEmail: false,
    ...overrides,
  };
}

describe('resolveStatusBarDisplay', () => {
  it('returns the account-selection item without an active profile', () => {
    const display = resolveStatusBarDisplay(input({ activeProfile: null }));

    assert.equal(display.kind, 'item');
    if (display.kind === 'item') {
      assert.equal(display.text, '$(account) Select account');
      assert.equal(display.tooltipKind, 'plain');
    }
  });

  it('hides the item when quota and profile display are disabled', () => {
    const display = resolveStatusBarDisplay(
      input({ showIncluded: false, showTotal: false, showProfileName: false })
    );

    assert.deepEqual(display, { kind: 'hidden' });
  });

  it('renders the profile-only item when quota display is disabled', () => {
    const display = resolveStatusBarDisplay(
      input({ showIncluded: false, showTotal: false })
    );

    assert.equal(display.kind, 'item');
    if (display.kind === 'item') {
      assert.equal(display.text, '$(account) Work');
      assert.equal(display.tooltipKind, 'plain');
      assert.match(display.tooltip, /work@example.com/);
    }
  });

  it('renders the loading state with the profile suffix policy', () => {
    const display = resolveStatusBarDisplay(input({ quotaLoading: true }));

    assert.equal(display.kind, 'item');
    if (display.kind === 'item') {
      assert.match(display.text, /Usage… \(Work\)/);
      assert.equal(display.tooltipKind, 'plain');
    }
  });

  it('renders quota errors with a warning background', () => {
    const display = resolveStatusBarDisplay(
      input({ quotaError: 'Quota service unavailable' })
    );

    assert.equal(display.kind, 'item');
    if (display.kind === 'item') {
      assert.equal(display.tooltip, 'Quota service unavailable');
      assert.equal(display.background, 'warning');
    }
  });

  it('renders a markdown quota item with a threshold background', () => {
    const display = resolveStatusBarDisplay(
      input({ cachedUsage: usage({ apiPercentUsed: 100, autoPercentUsed: 100 }) })
    );

    assert.equal(display.kind, 'item');
    if (display.kind === 'item') {
      assert.equal(display.tooltipKind, 'markdown');
      assert.equal(display.background, 'error');
      assert.match(display.text, /100%/);
    }
  });
});
