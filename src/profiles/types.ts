import {
  ActivityLeaderboardSnapshot,
  ProfileAccountView,
  QuotaUsage,
  getEffectiveUsagePercent,
} from '../api/types';

/**
 * Represents a single Cursor account profile.
 */
export interface Profile {
  /** Unique identifier (UUID v4) */
  id: string;

  /** Cursor account email address (primary key) */
  email: string;

  /**
   * URL-safe slug generated from email.
   * May include 8-char hash suffix if collision detected.
   */
  slug: string;

  /** User-friendly display name */
  displayName: string;

  /** Absolute path to --user-data-dir for this profile */
  userDataDir: string;

  /** ISO 8601 timestamp when profile was created */
  created: string;

  /** ISO 8601 timestamp when profile was last launched */
  lastLaunched?: string;

  /** VS Code theme name for visual identification */
  theme?: string;

  /** Hex color code for UI identification (#rrggbb) */
  color?: string;

  /** User-chosen emoji for visual identification */
  emoji?: string;

  /** When true, analyze Composer prompts for model efficiency (per profile). */
  efficiencyAnalysisEnabled?: boolean;

  /** Additional metadata */
  metadata?: ProfileMetadata;
}

export interface ProfileMetadata {
  /** How this profile was created */
  source?: 'manual' | 'imported' | 'detected';

  /** User notes about this profile */
  notes?: string;

  /** Tags for categorization */
  tags?: string[];

  /** Custom user data */
  [key: string]: unknown;
}

/**
 * Root configuration file structure.
 */
export interface ProfileConfig {
  /** Schema version for future migrations */
  version: string;

  /** List of all configured profiles */
  profiles: Profile[];

  /** Global settings for profile management */
  settings: ProfileSettings;
}

export interface ProfileSettings {
  /** Enable automatic detection of running instances */
  autoDetectRunning: boolean;

  /** Show current profile in status bar */
  showProfileInStatusBar: boolean;

  /** Interval for refreshing all profile quotas (seconds) */
  refreshAllInterval: number;

  /** Default theme for new profiles */
  defaultTheme?: string;

  /** Ask for confirmation before launching profile */
  confirmBeforeLaunch: boolean;
}

/**
 * Result of a validation operation.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Options for creating a new profile.
 */
export interface CreateProfileOptions {
  email: string;
  displayName?: string;
  theme?: string;
  color?: string;
  emoji?: string;
  notes?: string;
  tags?: string[];
}

/** Current schema version */
export const PROFILE_CONFIG_VERSION = '1.0.0';

/** Default configuration file location */
export const DEFAULT_CONFIG_DIR = '.cursor-accounts';
export const DEFAULT_CONFIG_FILE = 'config.json';

/** Default profile settings */
export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  autoDetectRunning: true,
  showProfileInStatusBar: true,
  refreshAllInterval: 300,
  confirmBeforeLaunch: false,
};

/** Profile directory prefix */
export const PROFILE_DIR_PREFIX = '.cursor-';

/** Export format version */
export const PROFILE_EXPORT_VERSION = '1.0.0';

/**
 * Exported profile format (portable, no absolute paths or secrets).
 */
export interface ExportedProfile {
  email: string;
  displayName: string;
  theme?: string;
  color?: string;
  emoji?: string;
  settings?: Record<string, unknown>;
  metadata?: ProfileMetadata;
}

/**
 * Root export file format.
 */
export interface ProfileExport {
  version: string;
  exportedAt: string;
  exportedBy?: string;
  profiles: ExportedProfile[];
}

/**
 * Options for importing profiles.
 */
export interface ImportOptions {
  /** Skip profiles with duplicate emails */
  skipDuplicates: boolean;

  /** Overwrite existing profiles with same email */
  overwriteExisting: boolean;

  /** Import settings.json if present */
  importSettings: boolean;

  /** Validate imported data strictly */
  strictValidation: boolean;
}

/**
 * Result of a profile import operation.
 */
export interface ImportResult {
  success: boolean;
  imported: Profile[];
  skipped: ExportedProfile[];
  errors: Array<{
    profile: ExportedProfile;
    error: string;
  }>;
}

/** Pre-import validation result. */
export interface ImportValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Quota information for a specific profile.
 */
export interface ProfileQuota {
  profileId: string;
  quota: QuotaUsage | null;
  /** Top team AI activity (enterprise analytics leaderboard). */
  activityLeaderboard?: ActivityLeaderboardSnapshot | null;
  error?: string;
  fetchedAt: number;
}

/** Status category for quota thresholds. */
export type QuotaStatus = 'ok' | 'warning' | 'critical' | 'unavailable';

/** Determine quota status from usage data. */
export function getQuotaStatus(quota: QuotaUsage | null): QuotaStatus {
  if (!quota) {
    return 'unavailable';
  }

  const percent = getEffectiveUsagePercent(quota);

  if (percent >= 95) {
    return 'critical';
  }
  if (percent >= 85) {
    return 'warning';
  }
  return 'ok';
}

/** Serialized quota map for webview messaging (JSON-safe). */
export type ProfileQuotaMap = Record<string, ProfileQuota>;

/** Serialized live account map for webview messaging (JSON-safe). */
export type ProfileAccountMap = Record<string, ProfileAccountView>;

/**
 * Information about a running Cursor instance.
 */
export interface InstanceInfo {
  profileId: string;
  pid: number;
  startTime?: number;
  userDataDir: string;
  detectedAt: number;
}

/** Serialized instance map for webview messaging (JSON-safe). */
export type InstanceInfoMap = Record<string, InstanceInfo>;

/**
 * Messages sent from extension to webview.
 */
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

/**
 * Messages sent from webview to extension.
 */
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

/**
 * Initial data sent when webview loads.
 */
export interface InitData {
  profiles: Profile[];
  currentProfile: Profile | null;
  quotas: ProfileQuotaMap;
  profileAccounts: ProfileAccountMap;
  activeAccount?: ProfileAccountView | null;
  runningInstances: InstanceInfoMap;
}

/** Schema version for webview persisted state */
export const WEBVIEW_STATE_VERSION = 1;

/**
 * Persisted webview UI state (survives reloads).
 */
export interface WebviewPersistedState {
  version: number;
  showAddForm?: boolean;
  editingProfileId?: string | null;
}
