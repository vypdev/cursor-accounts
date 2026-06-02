import type { ActivityLeaderboardSnapshot } from '../entities/ActivityLeaderboard';
import type { ProfileAccountView } from '../entities/AccountView';
import type { Profile, ImportOptions } from '../entities/Profile';
import type {
  ProfileGithubSummariesMap,
  ProfileGithubTokenStatusMap,
} from '../entities/GitHub';
import type { WorkspaceInfo } from '../entities/Workspace';
import type { QuotaUsage } from '../entities/QuotaUsage';
import type {
  StorageBreakdown,
  StorageCleanupOptions,
  StorageCleanupResult,
} from '../entities/StorageInfo';

/** Quota information for a specific profile. */
export interface ProfileQuota {
  profileId: string;
  quota: QuotaUsage | null;
  activityLeaderboard?: ActivityLeaderboardSnapshot | null;
  error?: string;
  fetchedAt: number;
}

export type ProfileQuotaMap = Record<string, ProfileQuota>;
export type ProfileAccountMap = Record<string, ProfileAccountView>;

/** Information about a running Cursor instance. */
export interface InstanceInfo {
  profileId: string;
  pid: number;
  startTime?: number;
  userDataDir: string;
  detectedAt: number;
}

export type InstanceInfoMap = Record<string, InstanceInfo>;

/** Live update of workspace folders open in the active window. */
export interface OpenWorkspacesData {
  paths: string[];
  profileWorkspaces: Record<string, WorkspaceInfo[]>;
}

/** Initial data sent when webview loads. */
export interface InitData {
  profiles: Profile[];
  profileWorkspaces: Record<string, WorkspaceInfo[]>;
  currentProfile: Profile | null;
  quotas: ProfileQuotaMap;
  profileAccounts: ProfileAccountMap;
  activeAccount?: ProfileAccountView | null;
  runningInstances: InstanceInfoMap;
  openWorkspacePaths: string[];
  profileGithubSummaries: ProfileGithubSummariesMap;
  profileGithubTokenStatus: ProfileGithubTokenStatusMap;
  locale: string;
  messages: Record<string, string>;
}

/** Persisted webview UI state (survives reloads). */
export interface WebviewPersistedState {
  version: number;
  showAddForm?: boolean;
  editingProfileId?: string | null;
}

/** Messages sent from extension to webview. */
export type ToWebviewMessage =
  | { type: 'init'; data: InitData }
  | { type: 'profiles'; data: Profile[] }
  | { type: 'currentProfile'; data: Profile | null }
  | { type: 'quotas'; data: ProfileQuotaMap }
  | { type: 'profileAccounts'; data: ProfileAccountMap }
  | { type: 'activeAccount'; data: ProfileAccountView | null }
  | { type: 'accountsLoading'; data: boolean }
  | { type: 'runningInstances'; data: InstanceInfoMap }
  | { type: 'openWorkspaces'; data: OpenWorkspacesData }
  | { type: 'error'; message: string }
  | { type: 'success'; message: string }
  | { type: 'exportData'; data: string; filename: string }
  | { type: 'suggestedProfile'; email?: string; displayName?: string; notice?: string }
  | { type: 'storageInfo'; data: StorageBreakdown }
  | { type: 'storageCleanupResult'; data: StorageCleanupResult }
  | {
      type: 'githubSummaries';
      data: {
        summaries: ProfileGithubSummariesMap;
        tokenStatus: ProfileGithubTokenStatusMap;
      };
    };

/** Messages sent from webview to extension. */
export type FromWebviewMessage =
  | { type: 'ready' }
  | { type: 'requestInit' }
  | { type: 'refresh' }
  | {
      type: 'webviewLog';
      level: 'info' | 'debug';
      message: string;
      phase?: string;
    }
  | { type: 'launch'; profileId: string; projectPath?: string }
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
  | { type: 'toggleEfficiency'; profileId: string; enabled: boolean }
  | { type: 'requestStorageInfo'; profileId: string }
  | { type: 'cleanStorage'; profileId: string; options: StorageCleanupOptions }
  | { type: 'configureGithubToken'; profileId: string }
  | { type: 'clearGithubToken'; profileId: string };
