import type { ProfileQuota } from '@cursor-accounts/types';

export interface QuotaRefreshSummary {
  total: number;
  successful: number;
  failed: number;
}

/** Build the stable public error row for one profile fetch failure. */
export function createQuotaFailure(
  profileId: string,
  error: unknown,
  fetchedAt: number
): ProfileQuota {
  const message = error instanceof Error ? error.message : 'Failed to fetch quota';
  return {
    profileId,
    quota: null,
    error: message,
    fetchedAt,
  };
}

/** Map transport/auth errors to messages suitable for the accounts panel. */
export function mapQuotaAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes('401') ||
    lower.includes('expired') ||
    lower.includes('unauthorized')
  ) {
    return 'Authentication expired. Launch profile to sign in again.';
  }
  if (lower.includes('not signed in') || lower.includes('sign in')) {
    return 'Launch this profile and sign in to see quota.';
  }
  return message;
}

/** Summarize a completed map without coupling the service to UI concerns. */
export function summarizeQuotaRefresh(
  quotas: ReadonlyMap<string, ProfileQuota>
): QuotaRefreshSummary {
  let successful = 0;
  for (const entry of quotas.values()) {
    if (entry.quota) {
      successful += 1;
    }
  }
  return {
    total: quotas.size,
    successful,
    failed: quotas.size - successful,
  };
}

/** Build an empty leaderboard result for a recoverable fetch failure. */
export function createLeaderboardFailure(
  error: unknown,
  fetchedAt: number
) {
  return {
    entries: [],
    periodStart: '',
    periodEnd: '',
    fetchedAt,
    error: error instanceof Error ? error.message : 'Unknown error',
  };
}
