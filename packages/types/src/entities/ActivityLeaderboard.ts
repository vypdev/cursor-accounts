/** One row in the team AI activity leaderboard (composer lines). */
export interface ActivityLeaderboardEntry {
  rank: number;
  displayName: string;
  email: string;
  composerLinesAccepted: number;
  favoriteModel?: string;
}

/** Top-N team activity snapshot from analytics leaderboard API. */
export interface ActivityLeaderboardSnapshot {
  entries: ActivityLeaderboardEntry[];
  totalRankedUsers?: number;
  periodStart: string;
  periodEnd: string;
  fetchedAt: number;
  error?: string;
}
