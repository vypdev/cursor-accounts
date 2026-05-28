/**
 * Mirror of extension-side types for webview consumption.
 *
 * IMPORTANT: Keep in sync with src/profiles/types.ts
 * These are duplicated because webview cannot import from extension code.
 */

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
}

export interface ProfileQuota {
  profileId: string;
  quota: QuotaUsage | null;
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

export function getQuotaStatus(quota: QuotaUsage | null): QuotaStatus {
  if (!quota) {
    return 'unavailable';
  }

  const percent = quota.totalPercentUsed;

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
  | { type: 'requestSuggestedProfile' };

export const WEBVIEW_STATE_VERSION = 1;

export interface WebviewPersistedState {
  version: number;
  showAddForm?: boolean;
  editingProfileId?: string | null;
}
