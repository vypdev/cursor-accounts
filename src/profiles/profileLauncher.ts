import * as path from 'path';
import * as extensionLog from '../logging/extensionLog';
import { ensureDirectory } from '../utils/pathUtils';
import type { IInstanceDetector } from '../domain/ports/IInstanceDetector';
import type { IProfileLauncher } from '../domain/ports/IProfileLauncher';
import type { IProfileProcessLauncher } from '../domain/ports/IProfileProcessLauncher';
import type {
  IProfileProxyLaunchCoordinator,
  ProfileProxyLaunchContext,
} from '../domain/ports/IProfileProxyLaunchCoordinator';
import type { IProfileWriter } from '../domain/ports/IProfileWriter';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import type { IProxyCertificate } from '../domain/ports/IProxyCertificate';
import type { IProxyLifecycle } from '../domain/ports/IProxyLifecycle';
import type { IProxyRouting } from '../domain/ports/IProxyRouting';
import { isProfilePresentInInstances } from './instanceDetector';
import {
  defaultProfileProcessLauncher,
  ProfileLauncherError,
} from './profileProcessLauncher';
import { ProfileProxyLaunchCoordinator } from './profileProxyLaunchCoordinator';
import type { Profile } from './types';

export {
  buildSpawnEnv,
  ProfileLauncherError,
  SPAWN_ENV_STRIP_KEYS,
} from './profileProcessLauncher';

export interface LaunchResult {
  success: boolean;
  pid?: number;
  error?: string;
}

export interface LaunchOptions {
  /** Bypass running-instance check. Can cause data corruption if profile is open. */
  force?: boolean;
  /** Optional folder or workspace file path to open in the new window. */
  projectPath?: string;
}

const LAUNCH_VERIFY_TIMEOUT_MS = 5000;
const LAUNCH_VERIFY_INTERVAL_MS = 500;

/** Optional launch flags when a profile MITM proxy is active. */
export interface LaunchArgsOptions {
  /** Full proxy URL, e.g. http://127.0.0.1:8081 from ProxyManager.getProxyServerUrl. */
  proxyUrl?: string;
}

interface PreparedLaunch {
  execPath: string;
  args: string[];
  launchContext: ProfileProxyLaunchContext | null;
}

export function proxyServerLaunchArg(proxyUrl: string): string {
  return `--proxy-server=${proxyUrl}`;
}

  /** Build argv for Cursor with optional project path and Chromium proxy flag. */
export function buildLaunchArgs(
  userDataDir: string,
  projectPath?: string,
  options?: LaunchArgsOptions
): string[] {
  const args = ['--user-data-dir', userDataDir];
  if (options?.proxyUrl) {
    args.push(proxyServerLaunchArg(options.proxyUrl));
  }
  if (projectPath) {
    args.push(projectPath);
  }
  return args;
}

/** Manual launch command shown when automated launch verification fails. */
export function buildManualLaunchCommand(
  userDataDir: string,
  proxyUrl?: string
): string {
  const proxyArg = proxyUrl ? ` ${proxyServerLaunchArg(proxyUrl)}` : '';
  switch (process.platform) {
    case 'darwin':
      return `open -na "/Applications/Cursor.app" --args --user-data-dir="${userDataDir}"${proxyArg}`;
    case 'win32': {
      const localAppData = process.env.LOCALAPPDATA;
      const execPath = localAppData
        ? path.join(localAppData, 'Programs', 'Cursor', 'Cursor.exe')
        : 'Cursor.exe';
      return `"${execPath}" --user-data-dir="${userDataDir}"${proxyArg}`;
    }
    default:
      return `cursor --user-data-dir="${userDataDir}"${proxyArg}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ProfileLauncher implements IProfileLauncher {
  constructor(
    private readonly profileWriter: IProfileWriter,
    private readonly instanceDetector?: IInstanceDetector,
    proxyManager?:
      IProxyLifecycle & IProxyRouting & IProxyCertificate,
    profileSettingsManager?: IProfileSettingsManager,
    private readonly processLauncher: IProfileProcessLauncher =
      defaultProfileProcessLauncher,
    proxyLaunchCoordinator?: IProfileProxyLaunchCoordinator
  ) {
    this.proxyLaunchCoordinator =
      proxyLaunchCoordinator ??
      new ProfileProxyLaunchCoordinator(proxyManager, profileSettingsManager);
  }

  private readonly proxyLaunchCoordinator: IProfileProxyLaunchCoordinator;

  /**
   * Launch Cursor with the specified profile.
   */
  async launch(
    profileId: string,
    options?: LaunchOptions
  ): Promise<LaunchResult> {
    try {
      const profile = await this.profileWriter.getProfile(profileId);
      if (!profile) {
        extensionLog.warn(
          `[ProfileLauncher] Launch failed: profile ${profileId} not found`
        );
        return {
          success: false,
          error: `Profile with ID ${profileId} not found`,
        };
      }

      if (options?.force) {
        extensionLog.warn(
          `[ProfileLauncher] Force launching profile ${profileId} (${profile.displayName})`
        );
      } else {
        extensionLog.info(
          `[ProfileLauncher] Launching profile ${profileId} (${profile.displayName})`
        );
      }

      const conflict = await this.findLaunchConflict(
        profileId,
        profile.displayName,
        options
      );
      if (conflict) {
        return {
          success: false,
          error: conflict,
        };
      }

      return await this.launchWithProfile(profile, options?.projectPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      extensionLog.error(
        `[ProfileLauncher] Launch failed for ${profileId}: ${message}`
      );
      return {
        success: false,
        error: message,
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
  async launchWithPath(
    userDataDir: string,
    projectPath?: string
  ): Promise<LaunchResult> {
    try {
      const preparedLaunch = await this.prepareLaunch(userDataDir, projectPath);
      await this.processLauncher.launch({
        executablePath: preparedLaunch.execPath,
        args: preparedLaunch.args,
        caCertPath: preparedLaunch.launchContext?.caCertPath || undefined,
        appBundlePath:
          process.platform === 'darwin' ? this.getAppBundlePath() : undefined,
      });
      return await this.completeLaunch(
        userDataDir,
        preparedLaunch.launchContext?.proxyUrl
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      extensionLog.error(`[ProfileLauncher] Failed to spawn Cursor: ${message}`);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Poll until a Cursor process with the given user data directory appears.
   */
  async waitForInstance(
    userDataDir: string,
    timeoutMs = LAUNCH_VERIFY_TIMEOUT_MS,
    intervalMs = LAUNCH_VERIFY_INTERVAL_MS
  ): Promise<number | undefined> {
    if (!this.instanceDetector) {
      return undefined;
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const proc =
        await this.instanceDetector.findProcessByUserDataDir(userDataDir);
      if (proc) {
        return proc.pid;
      }
      await sleep(intervalMs);
    }

    return undefined;
  }

  /**
   * Get Cursor .app bundle path (macOS `open` target).
   */
  getAppBundlePath(): string {
    switch (process.platform) {
      case 'darwin':
        return '/Applications/Cursor.app';
      case 'win32': {
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData) {
          return path.join(localAppData, 'Programs', 'Cursor');
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
   * Get Cursor executable path for current platform.
   */
  getExecutablePath(): string {
    switch (process.platform) {
      case 'darwin':
        return path.join(
          this.getAppBundlePath(),
          'Contents',
          'MacOS',
          'Cursor'
        );
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
  buildLaunchArgs(
    userDataDir: string,
    projectPath?: string,
    options?: LaunchArgsOptions
  ): string[] {
    return buildLaunchArgs(userDataDir, projectPath, options);
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

  private async launchWithProfile(
    profile: Profile,
    projectPath?: string
  ): Promise<LaunchResult> {
    return await this.launchWithPath(profile.userDataDir, projectPath);
  }

  private async findLaunchConflict(
    profileId: string,
    displayName: string,
    options?: LaunchOptions
  ): Promise<string | undefined> {
    if (!this.instanceDetector || options?.force) {
      return undefined;
    }

    if (options?.projectPath) {
      const projectAlreadyOpen =
        await this.instanceDetector.isProfileProjectRunning(
          profileId,
          options.projectPath
        );
      if (!projectAlreadyOpen) {
        return undefined;
      }
      extensionLog.warn(
        `[ProfileLauncher] Project already open for profile ${profileId}: ${options.projectPath}`
      );
      return `This project is already open for profile "${displayName}".`;
    }

    const instances = await this.instanceDetector.detectRunningInstances();
    if (!isProfilePresentInInstances(instances, profileId)) {
      return undefined;
    }
    extensionLog.warn(
      `[ProfileLauncher] Profile ${profileId} is already running`
    );
    return `Profile "${displayName}" is already running. Close the existing window first.`;
  }

  private async prepareLaunch(
    userDataDir: string,
    projectPath?: string
  ): Promise<PreparedLaunch> {
    await ensureDirectory(userDataDir);
    const profile = await this.profileWriter.findProfileByPath(userDataDir);
    const launchContext = profile
      ? await this.proxyLaunchCoordinator.resolve(profile, userDataDir)
      : null;
    const execPath = this.getExecutablePath();
    const args = this.buildLaunchArgs(userDataDir, projectPath, {
      proxyUrl: launchContext?.proxyUrl,
    });

    extensionLog.info(
      `[ProfileLauncher] Spawn: ${this.formatSpawnCommand(execPath, args)}`
    );
    return { execPath, args, launchContext };
  }

  private async completeLaunch(
    userDataDir: string,
    proxyUrl?: string
  ): Promise<LaunchResult> {
    const pid = this.instanceDetector
      ? await this.waitForInstance(userDataDir)
      : undefined;
    if (this.instanceDetector && pid == null) {
      const manualCmd = buildManualLaunchCommand(userDataDir, proxyUrl);
      extensionLog.warn(
        `[ProfileLauncher] Cursor did not start for ${userDataDir}`
      );
      return {
        success: false,
        error: `Cursor did not start. Try launching manually from Terminal:\n${manualCmd}`,
      };
    }

    await this.recordLaunch(userDataDir);
    extensionLog.info(
      `[ProfileLauncher] Instance detected (pid ${pid ?? 'unknown'})`
    );
    return { success: true, pid };
  }

  private async recordLaunch(userDataDir: string): Promise<void> {
    const matchedProfile = await this.profileWriter.findProfileByPath(userDataDir);
    if (!matchedProfile) {
      return;
    }
    await this.profileWriter.updateProfile(matchedProfile.id, {
      lastLaunched: new Date().toISOString(),
    });
  }

  private formatSpawnCommand(execPath: string, args: string[]): string {
    if (process.platform === 'darwin') {
      const appPath = this.getAppBundlePath();
      return `open -na ${JSON.stringify(appPath)} --args ${args.map((arg) => JSON.stringify(arg)).join(' ')}`;
    }

    return [execPath, ...args.map((arg) => JSON.stringify(arg))].join(' ');
  }

}
