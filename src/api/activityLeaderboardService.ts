import type { ActivityLeaderboardSnapshot } from '@cursor-accounts/types';
import type { IActivityLeaderboardService } from '../domain/ports/IActivityLeaderboardService';
import {
  defaultLeaderboardPeriod,
  fetchUsageLeaderboard,
} from './analyticsLeaderboardClient';
import { fetchDashboardTeams } from './teamMetadataClient';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Fetches enterprise team activity leaderboards via dashboard APIs. */
export class ActivityLeaderboardService implements IActivityLeaderboardService {
  async fetchSnapshot(
    accessToken: string,
    signal?: AbortSignal
  ): Promise<ActivityLeaderboardSnapshot> {
    const timeoutSignal = signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);

    try {
      const team = await fetchDashboardTeams(accessToken, timeoutSignal);
      if (!team?.teamId) {
        return {
          entries: [],
          periodStart: '',
          periodEnd: '',
          fetchedAt: Date.now(),
          error: 'Team not found',
        };
      }

      const { startDate, endDate } = defaultLeaderboardPeriod();
      return await fetchUsageLeaderboard(
        accessToken,
        {
          teamId: team.teamId,
          startDate,
          endDate,
          pageSize: 10,
        },
        timeoutSignal
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      const { startDate, endDate } = defaultLeaderboardPeriod();
      return {
        entries: [],
        periodStart: startDate,
        periodEnd: endDate,
        fetchedAt: Date.now(),
        error: message,
      };
    }
  }
}
