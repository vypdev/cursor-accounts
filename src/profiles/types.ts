import { QuotaUsage } from '../api/types';

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

/**
 * Quota information for a specific profile.
 */
export interface ProfileQuota {
  profileId: string;
  quota: QuotaUsage | null;
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

  const percent = quota.totalPercentUsed;

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

/**
 * Messages sent from extension to webview.
 */
export type ToWebviewMessage =
  | { type: 'init'; data: InitData }
  | { type: 'profiles'; data: Profile[] }
  | { type: 'currentProfile'; data: Profile | null }
  | { type: 'quotas'; data: ProfileQuotaMap }
  | { type: 'error'; message: string }
  | { type: 'success'; message: string };

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
    }
  | { type: 'edit'; profileId: string; updates: Partial<Profile> }
  | { type: 'delete'; profileId: string }
  | { type: 'showInExplorer'; profileId: string };

/**
 * Initial data sent when webview loads.
 */
export interface InitData {
  profiles: Profile[];
  currentProfile: Profile | null;
  quotas: ProfileQuotaMap;
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
