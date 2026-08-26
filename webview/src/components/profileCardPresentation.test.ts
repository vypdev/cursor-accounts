import { describe, expect, it, vi } from 'vitest';
import type { ProfileQuota, WorkspaceInfo } from '../types';
import {
  MAX_DISPLAY_WORKSPACES,
  formatDollarAmount,
  formatRemainingLabel,
  formatResetDate,
  getInitials,
  getRepositoryName,
  isAuthError,
} from './profileCardPresentation';

const translate = (
  key: string,
  args?: Record<string, string | number | undefined>
) =>
  `${key}:${args ? JSON.stringify(args) : ''}`;

const quota = {
  totalPercentUsed: 0,
  autoPercentUsed: 0,
  apiPercentUsed: 0,
  totalSpend: 1_000,
  includedSpend: 1_000,
  remaining: 250,
  limit: 2_000,
  billingCycleStart: '2026-08-01',
  billingCycleEnd: '2026-09-01',
  fetchedAt: 0,
} satisfies NonNullable<ProfileQuota['quota']>;

describe('profile card presentation', () => {
  it('formats initials and dollar amounts defensively', () => {
    expect(getInitials('Ada Lovelace')).toBe('AL');
    expect(getInitials('  ada  ')).toBe('A');
    expect(getInitials('   ')).toBe('?');
    expect(formatDollarAmount(1234)).toBe('12.34');
    expect(formatDollarAmount(Number.NaN)).toBe('0.00');
  });

  it('classifies authentication errors without matching unrelated errors', () => {
    expect(isAuthError('Authentication expired')).toBe(true);
    expect(isAuthError('Please sign in again')).toBe(true);
    expect(isAuthError('Network unavailable')).toBe(false);
  });

  it('formats remaining quota using the shared overage policy', () => {
    expect(formatRemainingLabel(quota, translate)).toContain(
      'profileCard.remaining:'
    );
  });

  it('handles invalid and near-term reset dates through the translator', () => {
    expect(formatResetDate('', translate)).toBe('profileCard.unknownDate:');
    expect(formatResetDate('not-a-date', translate)).toBe(
      'profileCard.unknownDate:'
    );

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T00:00:00.000Z'));
    expect(formatResetDate('2026-08-27T00:00:00.000Z', translate)).toContain(
      'profileCard.tomorrow:'
    );
    vi.useRealTimers();
  });

  it('prefers known workspace names and safely falls back to path segments', () => {
    const workspaces: WorkspaceInfo[] = [
      {
        name: 'Cursor Accounts',
        path: '/work/cursor-accounts',
        lastModified: '2026-08-26T00:00:00.000Z',
        storageHash: 'hash',
      },
    ];
    expect(getRepositoryName('/work/cursor-accounts', workspaces)).toBe(
      'Cursor Accounts'
    );
    expect(getRepositoryName('C:\\work\\other')).toBe('other');
    expect(getRepositoryName('', [])).toBe('');
    expect(MAX_DISPLAY_WORKSPACES).toBe(10);
  });
});
