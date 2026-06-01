/** Result of a deep database cleanup. */
export interface DeepCleanResult {
  backupPath: string;
  bytesReclaimed: number;
}

/**
 * Port for SQLite maintenance on a profile's `state.vscdb`.
 * Callers must ensure the profile is not running before invoking.
 */
export interface IDatabaseCleanupService {
  /** Compact the database and truncate WAL files. */
  vacuum(dbPath: string): Promise<void>;

  /**
   * Delete chat/composer/agent rows, vacuum, and return space reclaimed.
   * Creates a timestamped backup before modifying the database.
   */
  deepClean(dbPath: string): Promise<DeepCleanResult>;
}
