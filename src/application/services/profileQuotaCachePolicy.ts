import type {
  ActivityLeaderboardEntry,
  ActivityLeaderboardSnapshot,
  ProfileQuota,
  QuotaUsage,
} from '@cursor-accounts/types';

export interface SerializedProfileQuota {
  id: string;
  quota: ProfileQuota;
}

/** Convert the quota map to the stable shape persisted by the extension. */
export function serializeQuotaCache(
  quotas: ReadonlyMap<string, ProfileQuota>
): SerializedProfileQuota[] {
  return Array.from(quotas.entries()).map(([id, quota]) => ({ id, quota }));
}

/**
 * Parse persisted quota data defensively.
 *
 * Global state survives upgrades and manual edits, so malformed entries must
 * be ignored instead of preventing the accounts panel from loading.
 */
export function deserializeQuotaCache(value: unknown): Map<string, ProfileQuota> {
  if (!Array.isArray(value)) {
    return new Map();
  }

  const result = new Map<string, ProfileQuota>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id) {
      continue;
    }
    if (!isProfileQuota(item.quota) || item.quota.profileId !== item.id) {
      continue;
    }
    result.set(item.id, item.quota);
  }
  return result;
}

/** Parse the profile-keyed leaderboard cache without trusting its shape. */
export function deserializeLeaderboardCache(
  value: unknown
): Map<string, ActivityLeaderboardSnapshot> {
  if (!isRecord(value)) {
    return new Map();
  }

  const result = new Map<string, ActivityLeaderboardSnapshot>();
  for (const [profileId, snapshot] of Object.entries(value)) {
    if (!profileId || !isActivityLeaderboardSnapshot(snapshot)) {
      continue;
    }
    result.set(profileId, snapshot);
  }
  return result;
}

/** Convert a leaderboard map back to the profile-keyed persisted shape. */
export function serializeLeaderboardCache(
  snapshots: ReadonlyMap<string, ActivityLeaderboardSnapshot>
): Record<string, ActivityLeaderboardSnapshot> {
  return Object.fromEntries(snapshots.entries());
}

function isProfileQuota(value: unknown): value is ProfileQuota {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.profileId === 'string' &&
    (value.quota === null || isQuotaUsage(value.quota)) &&
    (value.activityLeaderboard === undefined ||
      value.activityLeaderboard === null ||
      isActivityLeaderboardSnapshot(value.activityLeaderboard)) &&
    (value.error === undefined || typeof value.error === 'string') &&
    isFiniteNumber(value.fetchedAt)
  );
}

function isQuotaUsage(value: unknown): value is QuotaUsage {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isFiniteNumber(value.totalPercentUsed) &&
    isFiniteNumber(value.autoPercentUsed) &&
    isFiniteNumber(value.apiPercentUsed) &&
    isFiniteNumber(value.totalSpend) &&
    isFiniteNumber(value.includedSpend) &&
    isFiniteNumber(value.remaining) &&
    isFiniteNumber(value.limit) &&
    typeof value.billingCycleStart === 'string' &&
    typeof value.billingCycleEnd === 'string' &&
    isFiniteNumber(value.fetchedAt)
  );
}

function isActivityLeaderboardSnapshot(
  value: unknown
): value is ActivityLeaderboardSnapshot {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    return false;
  }
  return (
    value.entries.every(isActivityLeaderboardEntry) &&
    (value.totalRankedUsers === undefined ||
      isFiniteNumber(value.totalRankedUsers)) &&
    typeof value.periodStart === 'string' &&
    typeof value.periodEnd === 'string' &&
    isFiniteNumber(value.fetchedAt) &&
    (value.error === undefined || typeof value.error === 'string')
  );
}

function isActivityLeaderboardEntry(
  value: unknown
): value is ActivityLeaderboardEntry {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isFiniteNumber(value.rank) &&
    typeof value.displayName === 'string' &&
    typeof value.email === 'string' &&
    isFiniteNumber(value.composerLinesAccepted) &&
    (value.favoriteModel === undefined ||
      typeof value.favoriteModel === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
