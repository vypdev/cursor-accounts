/** Per-profile storage breakdown in bytes. */
export interface StorageBreakdown {
  profileId: string;
  databaseBytes: number;
  walBytes: number;
  workspaceStorageBytes: number;
  editorCacheBytes: number;
  extensionCacheBytes: number;
  totalBytes: number;
  error?: string;
}

export function createEmptyStorageBreakdown(
  profileId: string,
  error?: string
): StorageBreakdown {
  return {
    profileId,
    databaseBytes: 0,
    walBytes: 0,
    workspaceStorageBytes: 0,
    editorCacheBytes: 0,
    extensionCacheBytes: 0,
    totalBytes: 0,
    error,
  };
}

export type StorageCleanupAction =
  | 'deleteOldChats'
  | 'gcAgentKvBlobs'
  | 'cleanExtensionCache'
  | 'cleanEditorCache'
  | 'vacuumDatabase'
  | 'deepCleanDatabase';

export interface StorageCleanupOptions {
  action: StorageCleanupAction;
  /** Age cutoff for delete-old-chats (current window only). */
  chatAgeDays?: number;
}

export interface StorageCleanupResult {
  success: boolean;
  bytesReclaimed: number;
  message: string;
  error?: string;
}
