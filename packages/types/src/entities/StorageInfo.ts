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
