import type { WorkspaceInfo } from './Workspace';

/** Represents a single Cursor account profile. */
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
  /** When false, this profile never starts or uses the MITM proxy. Default: true. */
  proxyEnabled?: boolean;
  /** When true, the MITM proxy writes JSONL traffic logs for this profile. Default: false. */
  proxyJsonlLoggingEnabled?: boolean;
  /** Absolute path to a file containing a GitHub PAT (optional, per profile). */
  githubTokenPath?: string;
  metadata?: ProfileMetadata;
}

export interface ProfileMetadata {
  source?: 'manual' | 'imported' | 'detected';
  notes?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface ProfileConfig {
  version: string;
  profiles: Profile[];
  settings: ProfileSettings;
}

export interface ProfileSettings {
  autoDetectRunning: boolean;
  showProfileInStatusBar: boolean;
  refreshAllInterval: number;
  defaultTheme?: string;
  confirmBeforeLaunch: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface CreateProfileOptions {
  email: string;
  displayName?: string;
  theme?: string;
  color?: string;
  emoji?: string;
  notes?: string;
  tags?: string[];
}

export interface ExportedProfile {
  email: string;
  displayName: string;
  theme?: string;
  color?: string;
  emoji?: string;
  settings?: Record<string, unknown>;
  metadata?: ProfileMetadata;
}

export interface ProfileExport {
  version: string;
  exportedAt: string;
  exportedBy?: string;
  profiles: ExportedProfile[];
}

export interface ImportOptions {
  skipDuplicates: boolean;
  overwriteExisting: boolean;
  importSettings: boolean;
  strictValidation: boolean;
}

export interface ImportResult {
  success: boolean;
  imported: Profile[];
  skipped: ExportedProfile[];
  errors: Array<{
    profile: ExportedProfile;
    error: string;
  }>;
}

export interface ImportValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Profile enriched with scanned workspace folders. */
export interface ProfileWithWorkspaces extends Profile {
  workspaces: WorkspaceInfo[];
  /** True when MITM proxy settings are temporarily applied in settings.json. */
  proxyTemporary?: boolean;
}
