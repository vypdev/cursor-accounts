import type { ChildProcess} from 'child_process';
import { spawn } from 'child_process';
import * as path from 'path';
import { isProfileProxyEnabled } from '@cursor-accounts/types';
import * as extensionLog from '../logging/extensionLog';
import { ensureDirectory } from '../utils/pathUtils';
import type { IInstanceDetector } from '../domain/ports/IInstanceDetector';
import type { IProfileLauncher } from '../domain/ports/IProfileLauncher';
import type { IProfileWriter } from '../domain/ports/IProfileWriter';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import type { IProxyCertificate } from '../domain/ports/IProxyCertificate';
import type { IProxyLifecycle } from '../domain/ports/IProxyLifecycle';
import type { IProxyRouting } from '../domain/ports/IProxyRouting';
import { isProfilePresentInInstances } from './instanceDetector';
import type { Profile } from './types';

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

/** Environment variables that break GUI launch when inherited from the extension host. */
export const SPAWN_ENV_STRIP_KEYS = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'ELECTRON_NO_ATTACH_CONSOLE',
] as const;

const LAUNCH_VERIFY_TIMEOUT_MS = 5000;
const LAUNCH_VERIFY_INTERVAL_MS = 500;

export class ProfileLauncherError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ProfileLauncherError';
  }
}

/** Optional launch flags when a profile MITM proxy is active. */
export interface LaunchArgsOptions {
  /** Full proxy URL, e.g. http://127.0.0.1:8081 from ProxyManager.getProxyServerUrl. */
  proxyUrl?: string;
}

export function proxyServerLaunchArg(proxyUrl: string): string {
  return `--proxy-server=${proxyUrl}`;
}

/**
 * Build a clean environment for spawning Cursor outside the extension host.
 */
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

export function buildSpawnEnv(caCertPath?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of SPAWN_ENV_STRIP_KEYS) {
    delete env[key];
  }
  delete env.NODE_EXTRA_CA_CERTS;
  if (caCertPath) {
    env.NODE_EXTRA_CA_CERTS = caCertPath;
  }
  return env;
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
    private readonly proxyManager?:
      IProxyLifecycle & IProxyRouting & IProxyCertificate,
    private readonly profileSettingsManager?: IProfileSettingsManager
  ) {}

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

      if (this.instanceDetector && !options?.force) {
        if (options?.projectPath) {
          const projectAlreadyOpen =
            await this.instanceDetector.isProfileProjectRunning(
              profileId,
              options.projectPath
            );
          if (projectAlreadyOpen) {
            extensionLog.warn(
              `[ProfileLauncher] Project already open for profile ${profileId}: ${options.projectPath}`
            );
            return {
              success: false,
              error: `This project is already open for profile "${profile.displayName}".`,
            };
          }
        } else {
          const instances =
            await this.instanceDetector.detectRunningInstances();
          if (isProfilePresentInInstances(instances, profileId)) {
            extensionLog.warn(
              `[ProfileLauncher] Profile ${profileId} is already running`
            );
            return {
              success: false,
              error: `Profile "${profile.displayName}" is already running. Close the existing window first.`,
            };
          }
        }
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
      await ensureDirectory(userDataDir);

      const profile = await this.profileWriter.findProfileByPath(userDataDir);
      const launchContext = profile
        ? await this.resolveProxyLaunchContext(profile.id, userDataDir)
        : null;

      const execPath = this.getExecutablePath();
      const args = this.buildLaunchArgs(userDataDir, projectPath, {
        proxyUrl: launchContext?.proxyUrl,
      });

      extensionLog.info(
        `[ProfileLauncher] Spawn: ${this.formatSpawnCommand(execPath, args)}`
      );

      await this.spawnProcess(
        execPath,
        args,
        launchContext?.caCertPath
      );

      let pid: number | undefined;
      if (this.instanceDetector) {
        pid = await this.waitForInstance(userDataDir);
      }

      if (this.instanceDetector && pid == null) {
        const manualCmd = buildManualLaunchCommand(
          userDataDir,
          launchContext?.proxyUrl
        );
        extensionLog.warn(
          `[ProfileLauncher] Cursor did not start for ${userDataDir}`
        );
        return {
          success: false,
          error: `Cursor did not start. Try launching manually from Terminal:\n${manualCmd}`,
        };
      }

      const matchedProfile = await this.profileWriter.findProfileByPath(userDataDir);
      if (matchedProfile) {
        await this.profileWriter.updateProfile(matchedProfile.id, {
          lastLaunched: new Date().toISOString(),
        });
      }

      extensionLog.info(
        `[ProfileLauncher] Instance detected (pid ${pid ?? 'unknown'})`
      );
      return {
        success: true,
        pid,
      };
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

  private formatSpawnCommand(execPath: string, args: string[]): string {
    if (process.platform === 'darwin') {
      const appPath = this.getAppBundlePath();
      return `open -na ${JSON.stringify(appPath)} --args ${args.map((arg) => JSON.stringify(arg)).join(' ')}`;
    }

    return [execPath, ...args.map((arg) => JSON.stringify(arg))].join(' ');
  }

  /**
   * Spawn Cursor process (platform-specific implementation).
   */
  private async resolveProxyLaunchContext(
    profileId: string,
    userDataDir: string
  ): Promise<{
    proxyUrl: string;
    caCertPath: string;
  } | null> {
    if (!this.proxyManager) {
      return null;
    }

    const profile = await this.profileWriter.getProfile(profileId);
    if (!profile || !isProfileProxyEnabled(profile)) {
      return null;
    }

    const running = await this.proxyManager.isRunning(profileId);
    if (!running) {
      const startResult = await this.proxyManager.ensureProfileProxy(profileId);
      if (!startResult.success) {
        extensionLog.warn(
          `[ProfileLauncher] Failed to start proxy for ${profileId}: ${startResult.error ?? 'unknown error'}`
        );
        return null;
      }
    }

    const proxyUrl = await this.proxyManager.getProxyServerUrl(profileId);
    if (!proxyUrl) {
      return null;
    }

    if (this.profileSettingsManager) {
      try {
        await this.profileSettingsManager.applyProxySettings(
          userDataDir,
          proxyUrl
        );
      } catch (error) {
        extensionLog.warn(
          `[ProfileLauncher] Failed to apply proxy settings for ${profileId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    const caCertPath = await this.proxyManager.getCertificatePath();
    if (!caCertPath) {
      return { proxyUrl, caCertPath: '' };
    }

    return { proxyUrl, caCertPath };
  }

  private async spawnProcess(
    execPath: string,
    args: string[],
    caCertPath?: string
  ): Promise<ChildProcess> {
    const spawnEnv = buildSpawnEnv(
      caCertPath && caCertPath.length > 0 ? caCertPath : undefined
    );

    return new Promise((resolve, reject) => {
      try {
        let proc: ChildProcess;

        if (process.platform === 'darwin') {
          const appPath = this.getAppBundlePath();
          proc = spawn('open', ['-na', appPath, '--args', ...args], {
            detached: true,
            stdio: 'ignore',
            env: spawnEnv,
          });
        } else if (process.platform === 'win32') {
          proc = spawn(execPath, args, {
            detached: true,
            stdio: 'ignore',
            env: spawnEnv,
          });
        } else {
          proc = spawn(execPath, args, {
            detached: true,
            stdio: 'ignore',
            env: spawnEnv,
          });
        }

        proc.on('error', (error) => {
          reject(
            new ProfileLauncherError(
              'Failed to spawn process',
              error instanceof Error ? error : undefined
            )
          );
        });

        if (process.platform === 'darwin') {
          // `open` exits 0 after handing off to LaunchServices; that is success.
          proc.on('exit', (code) => {
            if (code === 0) {
              resolve(proc);
            } else {
              reject(
                new ProfileLauncherError(
                  code != null
                    ? `Failed to open Cursor (exit ${code})`
                    : 'Process failed to start'
                )
              );
            }
          });
          return;
        }

        proc.unref();

        setTimeout(() => {
          if (
            proc.killed ||
            (proc.exitCode != null && proc.exitCode !== 0)
          ) {
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
