import type { ChildProcess, SpawnOptions } from 'child_process';
import { spawn } from 'child_process';
import type {
  IProfileProcessLauncher,
  ProfileProcessLaunchRequest,
} from '../domain/ports/IProfileProcessLauncher';

/** Environment variables that break GUI launch when inherited from the extension host. */
export const SPAWN_ENV_STRIP_KEYS = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'ELECTRON_NO_ATTACH_CONSOLE',
] as const;

const PROCESS_START_VERIFY_DELAY_MS = 500;

export class ProfileLauncherError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ProfileLauncherError';
  }
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

export interface ProfileProcessLauncherOptions {
  platform?: NodeJS.Platform;
  spawnProcess?: ProfileSpawnProcess;
  verifyDelayMs?: number;
}

type SpawnedProcess = ChildProcess;
export type ProfileSpawnProcess = (
  command: string,
  args?: readonly string[],
  options?: SpawnOptions
) => SpawnedProcess;

/**
 * Node child-process adapter for launching Cursor on supported desktop platforms.
 * The short verification window catches immediate process failures while leaving
 * long-running process ownership to Cursor and the instance detector.
 */
export class ProfileProcessLauncher implements IProfileProcessLauncher {
  private readonly platform: NodeJS.Platform;
  private readonly spawnProcess: ProfileSpawnProcess;
  private readonly verifyDelayMs: number;

  constructor(options: ProfileProcessLauncherOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.spawnProcess = options.spawnProcess ?? (spawn as ProfileSpawnProcess);
    this.verifyDelayMs = Math.max(
      0,
      options.verifyDelayMs ?? PROCESS_START_VERIFY_DELAY_MS
    );
  }

  async launch(request: ProfileProcessLaunchRequest): Promise<void> {
    const env = buildSpawnEnv(request.caCertPath);
    const command = this.platform === 'darwin' ? 'open' : request.executablePath;
    const args =
      this.platform === 'darwin'
        ? ['-na', request.appBundlePath ?? '/Applications/Cursor.app', '--args', ...request.args]
        : request.args;

    const child = this.spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      env,
    });

    if (this.platform === 'darwin') {
      await this.waitForLaunchServices(child);
      return;
    }

    child.unref();
    await this.verifyBackgroundProcess(child);
  }

  private spawn(
    command: string,
    args: string[],
    options: SpawnOptions
  ): SpawnedProcess {
    try {
      return this.spawnProcess(command, args, options);
    } catch (error) {
      throw new ProfileLauncherError(
        'Failed to spawn process',
        error instanceof Error ? error : undefined
      );
    }
  }

  private waitForLaunchServices(child: SpawnedProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        callback();
      };

      child.once('error', (error: Error) => {
        settle(() =>
          reject(
            new ProfileLauncherError(
              'Failed to spawn process',
              error instanceof Error ? error : undefined
            )
          )
        );
      });
      child.once('exit', (code: number | null) => {
        settle(() => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(
            new ProfileLauncherError(
              code != null
                ? `Failed to open Cursor (exit ${code})`
                : 'Process failed to start'
            )
          );
        });
      });
    });
  }

  private verifyBackgroundProcess(child: SpawnedProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (
          child.killed ||
          child.exitCode != null ||
          child.signalCode != null
        ) {
          reject(new ProfileLauncherError('Process failed to start'));
          return;
        }
        resolve();
      }, this.verifyDelayMs);

      child.once('error', (error: Error) => {
        clearTimeout(timer);
        reject(
          new ProfileLauncherError(
            'Failed to spawn process',
            error instanceof Error ? error : undefined
          )
        );
      });
    });
  }
}

export const defaultProfileProcessLauncher: IProfileProcessLauncher =
  new ProfileProcessLauncher();
