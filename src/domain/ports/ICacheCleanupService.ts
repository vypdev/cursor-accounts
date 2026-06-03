/**
 * Port for cache cleanup via filesystem and VS Code/Cursor built-in commands.
 */
export interface ICacheCleanupService {
  /** Remove editor cache directories under a profile user-data dir. Returns bytes removed. */
  cleanEditorCache(userDataDir: string): Promise<number>;

  /** Clear extension-owned quota/leaderboard cache for a profile. */
  cleanExtensionCache(profileId: string): Promise<void>;

  /**
   * Attempt built-in "Delete Old Chats" command for the active window.
   * @returns true when a command executed successfully.
   */
  deleteOldChats(chatAgeDays: number): Promise<boolean>;

  /**
   * Attempt built-in "GC Agent KV Blobs" command for the active window.
   * @returns true when a command executed successfully.
   */
  gcAgentKvBlobs(): Promise<boolean>;
}
