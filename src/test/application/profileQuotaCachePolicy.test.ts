import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deserializeLeaderboardCache,
  deserializeQuotaCache,
  serializeLeaderboardCache,
  serializeQuotaCache,
} from '../../application/services/profileQuotaCachePolicy';
import type { ActivityLeaderboardSnapshot, ProfileQuota } from '@cursor-accounts/types';

function makeQuota(profileId: string): ProfileQuota {
  return {
    profileId,
    quota: null,
    fetchedAt: 100,
  };
}

function makeLeaderboard(): ActivityLeaderboardSnapshot {
  return {
    entries: [
      {
        rank: 1,
        displayName: 'Ada',
        email: 'ada@example.com',
        composerLinesAccepted: 10,
      },
    ],
    periodStart: '2026-01-01',
    periodEnd: '2026-01-31',
    fetchedAt: 100,
  };
}

describe('profile quota cache policy', () => {
  it('round-trips valid quota entries', () => {
    const source = new Map([['profile-1', makeQuota('profile-1')]]);
    const serialized = serializeQuotaCache(source);

    assert.deepEqual(deserializeQuotaCache(serialized), source);
  });

  it('ignores malformed quota cache entries', () => {
    const cache = deserializeQuotaCache([
      { id: 'valid', quota: makeQuota('valid') },
      { id: 'mismatched', quota: makeQuota('other') },
      { id: 'missing-quota' },
      { id: 'invalid-time', quota: { ...makeQuota('invalid-time'), fetchedAt: 'now' } },
      'not-an-entry',
    ]);

    assert.deepEqual([...cache.keys()], ['valid']);
  });

  it('returns an empty map for malformed top-level cache data', () => {
    assert.equal(deserializeQuotaCache({}).size, 0);
    assert.equal(deserializeQuotaCache(null).size, 0);
  });

  it('round-trips valid leaderboard entries', () => {
    const source = new Map([['profile-1', makeLeaderboard()]]);
    const serialized = serializeLeaderboardCache(source);

    assert.deepEqual(deserializeLeaderboardCache(serialized), source);
  });

  it('ignores malformed leaderboard snapshots', () => {
    const cache = deserializeLeaderboardCache({
      valid: makeLeaderboard(),
      invalid: { entries: [], periodStart: '', periodEnd: '', fetchedAt: 'now' },
    });

    assert.deepEqual([...cache.keys()], ['valid']);
  });
});
