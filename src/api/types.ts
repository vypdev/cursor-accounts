import type { AccountMembership } from '../domain';

export type {
  AccountMembership,
  ActivityLeaderboardEntry,
  ActivityLeaderboardSnapshot,
  CursorAuthTokens,
  ProfileAccountView,
  QuotaUsage,
  UsageDataSource,
  UsageDisplayMode,
} from '../domain';

export {
  getEffectiveUsagePercent,
  getPersonalModeAveragePercent,
  isEnterpriseUsage,
} from '../domain';

export interface CursorAccountInfo {
  email: string;
  name: string;
  picture?: string;
  sub: string;
  id: number;
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
  overall?: UsageSummarySpendBucketRaw;
}

export interface UsageSummaryTeamRaw {
  onDemand?: UsageSummarySpendBucketRaw;
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
