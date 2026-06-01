import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ProfileConfig } from '@cursor-accounts/types';
import {
  DEFAULT_CONFIG_DIR,
  DEFAULT_CONFIG_FILE,
  DEFAULT_PROFILE_SETTINGS,
  PROFILE_CONFIG_VERSION,
} from '@cursor-accounts/types';
import type { IProfileStorage } from '../domain/ports/IProfileStorage';

export class ProfileStorageError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ProfileStorageError';
  }
}

export class ProfileStorage implements IProfileStorage {
  private readonly configPath: string;
  private configCache: ProfileConfig | null = null;

  constructor(configDir?: string) {
    const dir = configDir ?? path.join(os.homedir(), DEFAULT_CONFIG_DIR);
    this.configPath = path.join(dir, DEFAULT_CONFIG_FILE);
  }

  /**
   * Get the configuration file path.
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Check if the configuration file exists.
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load configuration from disk.
   * Creates default config if file doesn't exist.
   */
  async load(): Promise<ProfileConfig> {
    if (this.configCache) {
      return {
        ...this.configCache,
        profiles: [...this.configCache.profiles],
        settings: { ...this.configCache.settings },
      };
    }

    try {
      const fileExists = await this.exists();

      if (!fileExists) {
        const defaultConfig = this.createDefaultConfig();
        await this.save(defaultConfig);
        this.configCache = defaultConfig;
        return defaultConfig;
      }

      const content = await fs.readFile(this.configPath, 'utf-8');
      const config = JSON.parse(content) as ProfileConfig;

      const validated = this.validateAndMigrate(config);
      this.configCache = validated;

      return validated;
    } catch (error) {
      throw new ProfileStorageError(
        `Failed to load config from ${this.configPath}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Save configuration to disk.
   * Uses atomic write (write to temp file, then rename).
   */
  async save(config: ProfileConfig): Promise<void> {
    try {
      const dir = path.dirname(this.configPath);
      await fs.mkdir(dir, { recursive: true });

      const tempPath = `${this.configPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
      const content = JSON.stringify(config, null, 2);

      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, this.configPath);

      this.configCache = config;
    } catch (error) {
      throw new ProfileStorageError(
        `Failed to save config to ${this.configPath}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Create a backup of the current configuration.
   * Returns the backup file path.
   */
  async backup(): Promise<string> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${this.configPath}.backup.${timestamp}`;

      await fs.copyFile(this.configPath, backupPath);

      return backupPath;
    } catch (error) {
      throw new ProfileStorageError(
        'Failed to create backup',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Restore configuration from a backup file.
   */
  async restore(backupPath: string): Promise<void> {
    try {
      await fs.copyFile(backupPath, this.configPath);
      this.configCache = null;
    } catch (error) {
      throw new ProfileStorageError(
        `Failed to restore from backup: ${backupPath}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Clear the in-memory cache.
   */
  clearCache(): void {
    this.configCache = null;
  }

  private createDefaultConfig(): ProfileConfig {
    return {
      version: PROFILE_CONFIG_VERSION,
      profiles: [],
      settings: { ...DEFAULT_PROFILE_SETTINGS },
    };
  }

  private validateAndMigrate(config: ProfileConfig): ProfileConfig {
    if (!config.version) {
      config.version = PROFILE_CONFIG_VERSION;
    }

    if (!config.profiles) {
      config.profiles = [];
    }

    if (!config.settings) {
      config.settings = { ...DEFAULT_PROFILE_SETTINGS };
    }

    config.settings = {
      ...DEFAULT_PROFILE_SETTINGS,
      ...config.settings,
    };

    if (typeof config.settings.refreshAllInterval === 'number') {
      config.settings.refreshAllInterval = Math.max(
        60,
        Math.min(3600, config.settings.refreshAllInterval)
      );
    } else {
      config.settings.refreshAllInterval =
        DEFAULT_PROFILE_SETTINGS.refreshAllInterval;
    }

    if (typeof config.settings.autoDetectRunning !== 'boolean') {
      config.settings.autoDetectRunning =
        DEFAULT_PROFILE_SETTINGS.autoDetectRunning;
    }

    if (typeof config.settings.showProfileInStatusBar !== 'boolean') {
      config.settings.showProfileInStatusBar =
        DEFAULT_PROFILE_SETTINGS.showProfileInStatusBar;
    }

    if (typeof config.settings.confirmBeforeLaunch !== 'boolean') {
      config.settings.confirmBeforeLaunch =
        DEFAULT_PROFILE_SETTINGS.confirmBeforeLaunch;
    }

    return config;
  }
}
