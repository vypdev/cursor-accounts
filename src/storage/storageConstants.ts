/**
 * Storage cleanup constants with documented origins.
 * @see https://www.electronjs.org/docs/latest/api/app#appgetpathname
 */

/**
 * Editor cache directories under a profile user-data dir.
 * Based on Electron/Chromium cache structure:
 * - Cache: HTTP cache
 * - CachedData: V8 bytecode cache
 * - GPUCache: GPU process cache
 * - logs: Extension and process logs
 * - Code Cache: JavaScript code cache
 */
export const EDITOR_CACHE_DIRS = [
  'Cache',
  'CachedData',
  'GPUCache',
  'logs',
  'Code Cache',
] as const;

/**
 * Candidate command IDs for Cursor's built-in "Delete Old Chats".
 * Multiple IDs are tried because internal command names vary by Cursor version.
 */
export const DELETE_OLD_CHATS_COMMANDS = [
  'cursor.deleteOldChats',
  'developer.deleteOldChats',
  '_cursor.developer.deleteOldChats',
  'cursor.developer.deleteOldChats',
] as const;

/**
 * Candidate command IDs for Cursor's built-in "GC Agent KV Blobs".
 */
export const GC_AGENT_KV_COMMANDS = [
  'cursor.gcAgentKvBlobs',
  'developer.gcAgentKvBlobs',
  '_cursor.developer.gcAgentKvBlobs',
  'cursor.developer.gcAgentKvBlobs',
] as const;

/**
 * SQL script for deep database cleanup.
 * Removes composer bubbles, checkpoints, and agent KV blobs from cursorDiskKV,
 * then compacts the database. Chat history in other tables is not touched.
 */
export const DEEP_CLEAN_SQL = `
PRAGMA journal_mode=DELETE;
BEGIN IMMEDIATE;
DELETE FROM cursorDiskKV
WHERE key LIKE 'composerData:%'
   OR key LIKE 'bubbleId:%'
   OR key LIKE 'checkpointId:%'
   OR key LIKE 'agentKv:%';
COMMIT;
VACUUM;
PRAGMA wal_checkpoint(TRUNCATE);
`;

/** Extension globalState keys cleared by cleanExtensionCache. */
export const QUOTA_CACHE_KEY = 'multiProfileQuotaCache';
export const LEADERBOARD_CACHE_KEY = 'multiProfileLeaderboardCache';
