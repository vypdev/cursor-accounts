import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import * as extensionLog from '../logging/extensionLog';
import { pathsEqual } from '../utils/pathUtils';
import type { ProfileManager } from './profileManager';
import type { Profile } from './types';

export class ProfileDetectorError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ProfileDetectorError';
  }
}

type UserDataDirSource = 'globalStorageUri' | 'env' | 'argv' | 'default';

export class ProfileDetector {
  private currentProfile: Profile | null | undefined = undefined;
  private lastUserDataDirSource: UserDataDirSource | undefined;
  private loggedNonPrimarySource = false;

  constructor(
    private readonly profileManager: ProfileManager,
    private readonly context: vscode.ExtensionContext
  ) {}

  /**
   * Detect which profile the current instance is using.
   * Returns null if using default Cursor profile (no --user-data-dir).
   * Caches result after first call.
   */
  async detectCurrentProfile(): Promise<Profile | null> {
    if (this.currentProfile !== undefined) {
      return this.currentProfile;
    }

    try {
      const userDataDir = this.getCurrentUserDataDir();
      if (
        !this.loggedNonPrimarySource &&
        this.lastUserDataDirSource &&
        this.lastUserDataDirSource !== 'globalStorageUri'
      ) {
        this.loggedNonPrimarySource = true;
        extensionLog.debug(
          `[ProfileDetector] Current user data dir resolved via ${this.lastUserDataDirSource}`
        );
      }
      const defaultDir = this.getDefaultCursorUserDataDir();

      if (pathsEqual(userDataDir, defaultDir)) {
        this.currentProfile = null;
        return null;
      }

      const profile = await this.profileManager.findProfileByPath(userDataDir);
      this.currentProfile = profile ?? null;

      return this.currentProfile;
    } catch (error) {
      throw new ProfileDetectorError(
        'Failed to detect current profile',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get the current user data directory from VS Code API.
   *
   * globalStorageUri points to:
   * <userDataDir>/User/globalStorage/<publisher>.<extension>
   *
   * Navigate up 3 levels to get <userDataDir>.
   */
  getCurrentUserDataDir(): string {
    if (this.context?.globalStorageUri) {
      try {
        const globalStoragePath = this.context.globalStorageUri.fsPath;
        const userDataDir = path.dirname(
          path.dirname(path.dirname(globalStoragePath))
        );
        this.lastUserDataDirSource = 'globalStorageUri';
        return path.normalize(userDataDir);
      } catch {
        // Fall through to other detection methods.
      }
    }

    const envDir = process.env.VSCODE_USER_DATA_DIR;
    if (envDir) {
      this.lastUserDataDirSource = 'env';
      return path.normalize(envDir);
    }

    const args = process.argv;
    const userDataDirIndex = args.findIndex((arg) => arg === '--user-data-dir');
    const userDataDirArg = userDataDirIndex >= 0 ? args[userDataDirIndex + 1] : undefined;
    if (userDataDirArg) {
      this.lastUserDataDirSource = 'argv';
      return path.normalize(userDataDirArg);
    }

    this.lastUserDataDirSource = 'default';
    return this.getDefaultCursorUserDataDir();
  }

  /**
   * Get default Cursor user data directory for current platform.
   */
  getDefaultCursorUserDataDir(): string {
    const home = os.homedir();

    switch (process.platform) {
      case 'darwin':
        return path.join(home, 'Library', 'Application Support', 'Cursor');
      case 'win32':
        return path.join(
          process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
          'Cursor'
        );
      default:
        return path.join(home, '.config', 'Cursor');
    }
  }

  /**
   * Check if current instance is using default profile.
   */
  isDefaultProfile(): boolean {
    const userDataDir = this.getCurrentUserDataDir();
    const defaultDir = this.getDefaultCursorUserDataDir();
    return pathsEqual(userDataDir, defaultDir);
  }

  /**
   * Clear cached profile (force re-detection).
   */
  clearCache(): void {
    this.currentProfile = undefined;
    this.lastUserDataDirSource = undefined;
    this.loggedNonPrimarySource = false;
  }

  /**
   * Get a human-readable description of the current profile status.
   */
  async getProfileDescription(): Promise<string> {
    const profile = await this.detectCurrentProfile();
    return profile ? profile.displayName : 'Default Profile';
  }
}
