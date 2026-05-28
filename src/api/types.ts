/** Normalized quota snapshot used by UI and cache. */
export type AccountMembership = 'pro' | 'ultra' | 'enterprise' | string;
export type UsageDisplayMode = 'percent' | 'monthlySpend';
export type UsageDataSource = 'ide' | 'web';

export interface QuotaUsage {
  totalPercentUsed: number;
  autoPercentUsed: number;
  apiPercentUsed: number;
  totalSpend: number;
  includedSpend: number;
  remaining: number;
  limit: number;
  billingCycleStart: string;
  billingCycleEnd: string;
  displayMessage?: string;
  accountEmail?: string;
  fetchedAt: number;
  membershipType?: AccountMembership;
  limitType?: 'user' | 'team';
  displayMode?: UsageDisplayMode;
  /** On-demand monthly spend in cents (enterprise / web dashboard parity). */
  monthlySpend?: number;
  monthlyLimit?: number | null;
  /** Team pool on-demand spend in cents when available. */
  teamMonthlySpend?: number;
  teamMonthlyLimit?: number | null;
  dataSource?: UsageDataSource;
}

export interface CursorAuthTokens {
  accessToken: string;
  refreshToken?: string;
  email?: string;
}

export interface PlanUsageRaw {
  totalSpend?: number;
  includedSpend?: number;
  bonusSpend?: number;
  remaining?: number;
  limit?: number;
  autoPercentUsed?: number;
  apiPercentUsed?: number;
  totalPercentUsed?: number;
}

export interface SpendLimitUsageRaw {
  totalSpend?: number;
  pooledLimit?: number;
  pooledUsed?: number;
  pooledRemaining?: number;
  individualLimit?: number;
  individualUsed?: number;
  individualRemaining?: number;
  limitType?: 'user' | 'team';
}

export interface GetCurrentPeriodUsageResponse {
  billingCycleStart?: string;
  billingCycleEnd?: string;
  planUsage?: PlanUsageRaw;
  spendLimitUsage?: SpendLimitUsageRaw;
  displayMessage?: string;
  autoModelSelectedDisplayMessage?: string;
  namedModelSelectedDisplayMessage?: string;
}

export interface UsageSummarySpendBucketRaw {
  enabled?: boolean;
  used?: number | string;
  limit?: number | string | null;
  remaining?: number | string | null;
}

/** @deprecated Use UsageSummarySpendBucketRaw */
export type UsageSummaryOnDemandRaw = UsageSummarySpendBucketRaw;

export interface UsageSummaryPlanRaw {
  enabled?: boolean;
  used?: number;
  limit?: number;
  remaining?: number;
  autoPercentUsed?: number;
  apiPercentUsed?: number;
  totalPercentUsed?: number;
}

export interface UsageSummaryIndividualRaw {
  plan?: UsageSummaryPlanRaw;
  onDemand?: UsageSummarySpendBucketRaw;
  /** Enterprise Monthly Usage bucket (used/limit in cents). */
  overall?: UsageSummarySpendBucketRaw;
}

export interface UsageSummaryTeamRaw {
  onDemand?: UsageSummarySpendBucketRaw;
  /** Team pooled budget (cents). */
  pooled?: UsageSummarySpendBucketRaw;
}

export interface UsageSummaryResponse {
  billingCycleStart?: string;
  billingCycleEnd?: string;
  membershipType?: AccountMembership;
  limitType?: 'user' | 'team';
  isUnlimited?: boolean;
  autoModelSelectedDisplayMessage?: string;
  namedModelSelectedDisplayMessage?: string;
  individualUsage?: UsageSummaryIndividualRaw;
  teamUsage?: UsageSummaryTeamRaw;
}

export interface CursorAccountInfo {
  email: string;
  name: string;
  picture?: string;
  sub: string;
  id: number;
}

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

/** Live API account data for webview display (not persisted). */
export interface ProfileAccountView {
  profileId: string;
  accountName?: string;
  pictureUrl?: string;
  error?: string;
  fetchedAt: number;
}

/** Whether quota data represents an enterprise or team account. */
export function isEnterpriseUsage(quota: QuotaUsage | null | undefined): boolean {
  if (!quota) {
    return false;
  }
  return quota.membershipType === 'enterprise' || quota.limitType === 'team';
}

/** Effective usage percent for progress bars and status thresholds. */
export function getEffectiveUsagePercent(quota: QuotaUsage | null): number {
  if (!quota) {
    return 0;
  }

  if (quota.displayMode === 'monthlySpend') {
    const spend = quota.monthlySpend ?? 0;
    const limit = quota.monthlyLimit;
    if (limit != null && limit > 0) {
      return Math.min(100, Math.max(0, (spend / limit) * 100));
    }
    return 0;
  }

  return quota.totalPercentUsed;
}
