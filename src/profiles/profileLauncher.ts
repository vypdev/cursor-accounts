import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import { InstanceDetector } from './instanceDetector';
import { ProfileManager } from './profileManager';
import { Profile } from './types';

export interface LaunchResult {
  success: boolean;
  pid?: number;
  error?: string;
}

export interface LaunchOptions {
  /** Bypass running-instance check. Can cause data corruption if profile is open. */
  force?: boolean;
}

export class ProfileLauncherError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ProfileLauncherError';
  }
}

export class ProfileLauncher {
  constructor(
    private readonly profileManager: ProfileManager,
    private readonly instanceDetector?: InstanceDetector
  ) {}

  /**
   * Launch Cursor with the specified profile.
   */
  async launch(
    profileId: string,
    options?: LaunchOptions
  ): Promise<LaunchResult> {
    try {
      const profile = await this.profileManager.getProfile(profileId);
      if (!profile) {
        return {
          success: false,
          error: `Profile with ID ${profileId} not found`,
        };
      }

      if (this.instanceDetector && !options?.force) {
        const instances = await this.instanceDetector.detectRunningInstances();
        if (instances.has(profileId)) {
          return {
            success: false,
            error: `Profile "${profile.displayName}" is already running. Close the existing window first.`,
          };
        }
      }

      return await this.launchWithProfile(profile);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Launch profile with force flag to bypass running check.
   * USE WITH CAUTION: Can cause data corruption if profile already running.
   */
  async forceLaunch(profileId: string): Promise<LaunchResult> {
    return await this.launch(profileId, { force: true });
  }

  /**
   * Launch Cursor with a custom user-data-dir path.
   */
  async launchWithPath(userDataDir: string): Promise<LaunchResult> {
    try {
      const execPath = this.getExecutablePath();
      const args = this.buildLaunchArgs(userDataDir);

      const proc = await this.spawnProcess(execPath, args);

      const profile = await this.profileManager.findProfileByPath(userDataDir);
      if (profile) {
        await this.profileManager.updateProfile(profile.id, {
          lastLaunched: new Date().toISOString(),
        });
      }

      return {
        success: true,
        pid: proc.pid,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get Cursor executable path for current platform.
   */
  getExecutablePath(): string {
    switch (process.platform) {
      case 'darwin':
        return '/Applications/Cursor.app/Contents/MacOS/Cursor';
      case 'win32': {
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData) {
          return path.join(localAppData, 'Programs', 'Cursor', 'Cursor.exe');
        }
        throw new ProfileLauncherError(
          'LOCALAPPDATA environment variable not set'
        );
      }
      default:
        return '/usr/bin/cursor';
    }
  }

  /**
   * Build command line arguments for launching with profile.
   */
  buildLaunchArgs(userDataDir: string): string[] {
    return ['--user-data-dir', userDataDir];
  }

  /**
   * Build complete launch command for a profile.
   */
  buildLaunchCommand(profile: Profile): string[] {
    const execPath = this.getExecutablePath();
    const args = this.buildLaunchArgs(profile.userDataDir);
    return [execPath, ...args];
  }

  /**
   * Check if Cursor executable exists and is accessible.
   */
  async validateExecutable(): Promise<{ valid: boolean; error?: string }> {
    try {
      const execPath = this.getExecutablePath();
      const fs = await import('fs/promises');

      await fs.access(execPath);

      return { valid: true };
    } catch {
      return {
        valid: false,
        error:
          'Cursor executable not found. Please ensure Cursor is installed.',
      };
    }
  }

  private async launchWithProfile(profile: Profile): Promise<LaunchResult> {
    return await this.launchWithPath(profile.userDataDir);
  }

  /**
   * Spawn Cursor process (platform-specific implementation).
   */
  private async spawnProcess(
    execPath: string,
    args: string[]
  ): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      try {
        let proc: ChildProcess;

        if (process.platform === 'darwin') {
          proc = spawn('open', ['-na', execPath, '--args', ...args], {
            detached: true,
            stdio: 'ignore',
          });
        } else if (process.platform === 'win32') {
          proc = spawn(execPath, args, {
            detached: true,
            stdio: 'ignore',
            shell: true,
          });
        } else {
          proc = spawn(execPath, args, {
            detached: true,
            stdio: 'ignore',
          });
        }

        proc.unref();

        setTimeout(() => {
          if (proc.killed || proc.exitCode !== null) {
            reject(new ProfileLauncherError('Process failed to start'));
          } else {
            resolve(proc);
          }
        }, 500);
      } catch (error) {
        reject(
          new ProfileLauncherError(
            'Failed to spawn process',
            error instanceof Error ? error : undefined
          )
        );
      }
    });
  }
}
