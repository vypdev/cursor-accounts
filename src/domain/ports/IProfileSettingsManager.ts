/** Proxy backup state for a profile's settings.json. */
export interface ProxyBackupInfo {
  hasBackup: boolean;
  currentProxyUrl?: string;
  backupProxyUrl?: string;
}

/** Port for reading/writing profile User/settings.json and proxy overrides. */
export interface IProfileSettingsManager {
  /**
   * Read settings.json from a profile's user data directory.
   * Returns null if file doesn't exist.
   */
  readSettings(userDataDir: string): Promise<Record<string, unknown> | null>;

  /**
   * Write settings.json to a profile's user data directory.
   * Creates User/ directory if needed.
   */
  writeSettings(
    userDataDir: string,
    settings: Record<string, unknown>
  ): Promise<void>;

  /**
   * Apply proxy settings to a profile, backing up existing http.proxy if present.
   * Idempotent: calling multiple times with same URL is safe.
   */
  applyProxySettings(userDataDir: string, proxyUrl: string): Promise<void>;

  /**
   * Restore original proxy settings from backup, or clear if no backup exists.
   * Idempotent: safe to call even if no proxy applied.
   */
  restoreProxySettings(userDataDir: string): Promise<void>;

  /**
   * Check if a profile has a proxy backup (indicating temporary proxy applied).
   */
  getProxyBackupInfo(userDataDir: string): Promise<ProxyBackupInfo>;
}
