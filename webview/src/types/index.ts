/**
 * Mirror of extension-side types for webview consumption.
 *
 * IMPORTANT: Keep in sync with src/api/types.ts and src/profiles/types.ts
 * These are duplicated because webview cannot import from extension code.
 */

export type AccountMembership = 'pro' | 'ultra' | 'enterprise' | string;
export type UsageDisplayMode = 'percent' | 'monthlySpend';
export type UsageDataSource = 'ide' | 'web';

export interface Profile {
  id: string;
  email: string;
  slug: string;
  displayName: string;
  userDataDir: string;
  created: string;
  lastLaunched?: string;
  theme?: string;
  color?: string;
  emoji?: string;
  efficiencyAnalysisEnabled?: boolean;
  metadata?: ProfileMetadata;
}

export interface ProfileMetadata {
  source?: 'manual' | 'imported' | 'detected';
  notes?: string;
  tags?: string[];
  [key: string]: unknown;
}

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
  monthlySpend?: number;
  monthlyLimit?: number | null;
  teamMonthlySpend?: number;
  teamMonthlyLimit?: number | null;
  dataSource?: UsageDataSource;
}

export interface ActivityLeaderboardEntry {
  rank: number;
  displayName: string;
  email: string;
  composerLinesAccepted: number;
  favoriteModel?: string;
}

export interface ActivityLeaderboardSnapshot {
  entries: ActivityLeaderboardEntry[];
  totalRankedUsers?: number;
  periodStart: string;
  periodEnd: string;
  fetchedAt: number;
  error?: string;
}

export interface ProfileQuota {
  profileId: string;
  quota: QuotaUsage | null;
  activityLeaderboard?: ActivityLeaderboardSnapshot | null;
  error?: string;
  fetchedAt: number;
}

/** Live API account data (not persisted). */
export interface ProfileAccountView {
  profileId: string;
  accountName?: string;
  pictureUrl?: string;
  error?: string;
  fetchedAt: number;
}

export type QuotaStatus = 'ok' | 'warning' | 'critical' | 'unavailable';

export function isEnterpriseUsage(quota: QuotaUsage | null | undefined): boolean {
  if (!quota) {
    return false;
  }
  return quota.membershipType === 'enterprise' || quota.limitType === 'team';
}

export function getPersonalModeAveragePercent(quota: QuotaUsage | null): number {
  if (!quota) {
    return 0;
  }
  const average = (quota.apiPercentUsed + quota.autoPercentUsed) / 2;
  if (!Number.isFinite(average)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(average)));
}

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

function getQuotaThresholdPercent(quota: QuotaUsage): number {
  if (!isEnterpriseUsage(quota) && quota.displayMode !== 'monthlySpend') {
    return getPersonalModeAveragePercent(quota);
  }
  return getEffectiveUsagePercent(quota);
}

export function getQuotaStatus(quota: QuotaUsage | null): QuotaStatus {
  if (!quota) {
    return 'unavailable';
  }

  const percent = getQuotaThresholdPercent(quota);

  if (percent >= 95) {
    return 'critical';
  }
  if (percent >= 85) {
    return 'warning';
  }
  return 'ok';
}

export type ProfileQuotaMap = Record<string, ProfileQuota>;
export type ProfileAccountMap = Record<string, ProfileAccountView>;

export interface InstanceInfo {
  profileId: string;
  pid: number;
  startTime?: number;
  userDataDir: string;
  detectedAt: number;
}

export type InstanceInfoMap = Record<string, InstanceInfo>;

export interface ExportedProfile {
  email: string;
  displayName: string;
  theme?: string;
  color?: string;
  emoji?: string;
  settings?: Record<string, unknown>;
  metadata?: ProfileMetadata;
}

export interface ImportOptions {
  skipDuplicates: boolean;
  overwriteExisting: boolean;
  importSettings: boolean;
  strictValidation: boolean;
}

export interface InitData {
  profiles: Profile[];
  currentProfile: Profile | null;
  quotas: ProfileQuotaMap;
  profileAccounts: ProfileAccountMap;
  activeAccount?: ProfileAccountView | null;
  runningInstances: InstanceInfoMap;
}

export type ToWebviewMessage =
  | { type: 'init'; data: InitData }
  | { type: 'profiles'; data: Profile[] }
  | { type: 'currentProfile'; data: Profile | null }
  | { type: 'quotas'; data: ProfileQuotaMap }
  | { type: 'profileAccounts'; data: ProfileAccountMap }
  | { type: 'activeAccount'; data: ProfileAccountView | null }
  | { type: 'accountsLoading'; data: boolean }
  | { type: 'runningInstances'; data: InstanceInfoMap }
  | { type: 'error'; message: string }
  | { type: 'success'; message: string }
  | { type: 'exportData'; data: string; filename: string }
  | { type: 'suggestedProfile'; email?: string; displayName?: string; notice?: string };

export type FromWebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'launch'; profileId: string }
  | {
      type: 'add';
      email: string;
      displayName?: string;
      theme?: string;
      color?: string;
      emoji?: string;
    }
  | { type: 'edit'; profileId: string; updates: Partial<Profile> }
  | { type: 'delete'; profileId: string }
  | { type: 'showInExplorer'; profileId: string }
  | { type: 'export'; profileIds: string[]; includeSettings: boolean }
  | { type: 'import'; data: string; options: ImportOptions }
  | { type: 'requestSuggestedProfile' }
  | { type: 'toggleEfficiency'; profileId: string; enabled: boolean };

export const WEBVIEW_STATE_VERSION = 1;

export interface WebviewPersistedState {
  version: number;
  showAddForm?: boolean;
  editingProfileId?: string | null;
}

function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) {
    return '$0.00';
  }
  return `$${(cents / 100).toFixed(2)}`;
}

/** Compact number for leaderboard metrics (e.g. 456728 → 457k). */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return String(Math.round(value));
}

/** Format monthly spend for profile card display. */
export function formatMonthlySpendLabel(quota: QuotaUsage): string {
  const spend = quota.monthlySpend ?? quota.totalSpend ?? 0;
  const limit = quota.monthlyLimit;
  if (limit == null) {
    return `${formatCents(spend)} / unlimited`;
  }
  return `${formatCents(spend)} / ${formatCents(limit)}`;
}

/** Format enterprise usage as percent + spend (e.g. "16% · $94.00/$600.00"). */
export function formatEnterpriseUsageLabel(quota: QuotaUsage): string {
  const percent = Math.round(getEffectiveUsagePercent(quota));
  return `${percent}% · ${formatMonthlySpendLabel(quota)}`;
}
