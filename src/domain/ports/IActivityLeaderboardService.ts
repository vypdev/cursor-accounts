import type { ActivityLeaderboardSnapshot } from '@cursor-accounts/types';

/** Port for fetching enterprise team activity leaderboards. */
export interface IActivityLeaderboardService {
  fetchSnapshot(
    accessToken: string,
    signal?: AbortSignal
  ): Promise<ActivityLeaderboardSnapshot>;
}
