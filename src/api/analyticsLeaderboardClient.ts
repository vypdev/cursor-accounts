import { buildWorkosSessionCookie } from '../auth/sessionCookie';
import type {
  ActivityLeaderboardEntry,
  ActivityLeaderboardSnapshot,
} from './types';

const LEADERBOARD_ENDPOINT =
  'https://cursor.com/api/v2/analytics/team/leaderboard';

export class AnalyticsLeaderboardApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = 'AnalyticsLeaderboardApiError';
  }
}

export interface FetchUsageLeaderboardParams {
  teamId: number;
  startDate: string;
  endDate: string;
  pageSize?: number;
}

interface LeaderboardMemberRaw {
  rank?: number;
  display_name?: string;
  email?: string;
  total_composer_lines_accepted?: number;
  favorite_model?: string;
}

interface LeaderboardBoardRaw {
  data?: LeaderboardMemberRaw[];
  total_users?: number;
}

interface UsageLeaderboardResponseRaw {
  composer_leaderboard?: LeaderboardBoardRaw;
  tab_leaderboard?: LeaderboardBoardRaw;
}

/** Format a Date as YYYY-MM-DD (local calendar, matches dashboard analytics URL). */
export function formatDateYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Default analytics window: last 30 days through today. */
export function defaultLeaderboardPeriod(): {
  startDate: string;
  endDate: string;
} {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  return {
    startDate: formatDateYmd(start),
    endDate: formatDateYmd(end),
  };
}

export function mapLeaderboardResponse(
  raw: UsageLeaderboardResponseRaw,
  periodStart: string,
  periodEnd: string,
  fetchedAt = Date.now()
): ActivityLeaderboardSnapshot {
  const board = raw.composer_leaderboard;
  const entries: ActivityLeaderboardEntry[] = (board?.data ?? [])
    .filter(
      (member): member is LeaderboardMemberRaw & { email: string } =>
        typeof member.email === 'string' && member.email.length > 0
    )
    .map((member) => ({
      rank: member.rank ?? 0,
      displayName: member.display_name?.trim() || member.email,
      email: member.email,
      composerLinesAccepted: member.total_composer_lines_accepted ?? 0,
      favoriteModel: member.favorite_model,
    }));

  return {
    entries,
    totalRankedUsers: board?.total_users,
    periodStart,
    periodEnd,
    fetchedAt,
  };
}

export async function fetchUsageLeaderboard(
  accessToken: string,
  params: FetchUsageLeaderboardParams,
  signal?: AbortSignal
): Promise<ActivityLeaderboardSnapshot> {
  const { teamId, startDate, endDate, pageSize = 10 } = params;

  const query = new URLSearchParams({
    startDate,
    endDate,
    teamId: String(teamId),
    pageSize: String(pageSize),
  });

  const cookie = buildWorkosSessionCookie(accessToken);
  const response = await fetch(`${LEADERBOARD_ENDPOINT}?${query.toString()}`, {
    method: 'GET',
    headers: {
      Cookie: cookie,
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AnalyticsLeaderboardApiError(
      text || `Analytics leaderboard API returned ${response.status}`,
      response.status
    );
  }

  const raw = (await response.json()) as UsageLeaderboardResponseRaw;
  return mapLeaderboardResponse(raw, startDate, endDate);
}
