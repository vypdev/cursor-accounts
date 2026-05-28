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
  metadata?: ProfileMetadata;
}

export interface ProfileMetadata {
  source?: 'manual' | 'imported' | 'detected';
  notes?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface InitData {
  profiles: Profile[];
  currentProfile: Profile | null;
}

export type ToWebviewMessage =
  | { type: 'init'; data: InitData }
  | { type: 'profiles'; data: Profile[] }
  | { type: 'currentProfile'; data: Profile | null }
  | { type: 'error'; message: string }
  | { type: 'success'; message: string };

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

export const WEBVIEW_STATE_VERSION = 1;

export interface WebviewPersistedState {
  version: number;
  showAddForm?: boolean;
  editingProfileId?: string | null;
}
