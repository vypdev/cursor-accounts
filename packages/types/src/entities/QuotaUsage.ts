/** Normalized quota snapshot used by UI and cache. */
export type AccountMembership = string;
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

export type QuotaStatus = 'ok' | 'warning' | 'critical' | 'unavailable';
