/** Normalized quota snapshot used by UI and cache. */
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

export interface GetCurrentPeriodUsageResponse {
  billingCycleStart?: string;
  billingCycleEnd?: string;
  planUsage?: PlanUsageRaw;
  displayMessage?: string;
}

export interface CursorAccountInfo {
  email: string;
  name: string;
  picture?: string;
  sub: string;
  id: number;
}

/** Live API account data for webview display (not persisted). */
export interface ProfileAccountView {
  profileId: string;
  accountName?: string;
  pictureUrl?: string;
  error?: string;
  fetchedAt: number;
}
