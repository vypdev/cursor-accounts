import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultLeaderboardPeriod,
  formatDateYmd,
  mapLeaderboardResponse,
} from '../api/analyticsLeaderboardClient';
import { first } from './testUtils';

describe('mapLeaderboardResponse', () => {
  it('maps composer leaderboard entries from v2 response', () => {
    const snapshot = mapLeaderboardResponse(
      {
        composer_leaderboard: {
          total_users: 610,
          data: [
            {
              rank: 1,
              display_name: 'Karmelo Nofuentes',
              email: 'karmelo.nofuentes@feverup.com',
              total_composer_lines_accepted: 456728,
              favorite_model: 'default',
            },
            {
              rank: 2,
              display_name: 'Borja Muñoz',
              email: 'borja.munoz@feverup.com',
              total_composer_lines_accepted: 244734,
            },
          ],
        },
      },
      '2026-04-29',
      '2026-05-28',
      1_700_000_000_000
    );

    assert.equal(snapshot.entries.length, 2);
    const topEntry = first(snapshot.entries);
    assert.equal(topEntry.rank, 1);
    assert.equal(topEntry.displayName, 'Karmelo Nofuentes');
    assert.equal(topEntry.composerLinesAccepted, 456728);
    assert.equal(topEntry.favoriteModel, 'default');
    assert.equal(snapshot.totalRankedUsers, 610);
    assert.equal(snapshot.periodStart, '2026-04-29');
    assert.equal(snapshot.periodEnd, '2026-05-28');
    assert.equal(snapshot.fetchedAt, 1_700_000_000_000);
  });

  it('skips members without email', () => {
    const snapshot = mapLeaderboardResponse(
      {
        composer_leaderboard: {
          data: [{ rank: 1, display_name: 'No Email User' }],
        },
      },
      '2026-01-01',
      '2026-01-31'
    );

    assert.equal(snapshot.entries.length, 0);
  });
});

describe('defaultLeaderboardPeriod', () => {
  it('returns a 30-day inclusive window ending today', () => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 30);

    const period = defaultLeaderboardPeriod();
    assert.equal(period.endDate, formatDateYmd(end));
    assert.equal(period.startDate, formatDateYmd(start));
  });
});
