import { buildWorkosSessionCookie } from '../auth/sessionCookie';

const DASHBOARD_TEAMS_ENDPOINT = 'https://cursor.com/api/dashboard/teams';

export class TeamMetadataApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = 'TeamMetadataApiError';
  }
}

export interface DashboardTeamInfo {
  teamId: number;
  teamName?: string;
  billingCycleStart?: string;
  billingCycleEnd?: string;
}

interface DashboardTeamsResponse {
  teams?: Array<{
    id?: number;
    name?: string;
    billingCycleStart?: string;
    billingCycleEnd?: string;
  }>;
}

export async function fetchDashboardTeams(
  accessToken: string,
  signal?: AbortSignal
): Promise<DashboardTeamInfo | null> {
  const cookie = buildWorkosSessionCookie(accessToken);

  const response = await fetch(DASHBOARD_TEAMS_ENDPOINT, {
    method: 'GET',
    headers: {
      Cookie: cookie,
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new TeamMetadataApiError(
      text || `Dashboard teams API returned ${response.status}`,
      response.status
    );
  }

  const data = (await response.json()) as DashboardTeamsResponse;
  const team = data.teams?.[0];
  if (team?.id == null) {
    return null;
  }

  return {
    teamId: team.id,
    teamName: team.name,
    billingCycleStart: team.billingCycleStart,
    billingCycleEnd: team.billingCycleEnd,
  };
}
