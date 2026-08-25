import * as extensionLog from '../logging/extensionLog';
import { pathsEqual } from '../utils/pathUtils';
import type { IInstanceDetector } from '../domain/ports/IInstanceDetector';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { InstanceInfo, InstanceInfoMap } from './types';

import {
  CursorProcessScanner,
  type CursorProcessProvider,
} from './cursorProcessScanner';
import type { CursorProcess } from './instanceProcessParser';

export type { CursorProcess } from './instanceProcessParser';
export {
  extractUserDataDir,
  extractProjectPath,
  isHelperProcess,
  parseLinuxPsOutput,
  parseMacOSPsOutput,
  parseWindowsPowerShellJson,
  parseWindowsWmicOutput,
} from './instanceProcessParser';

export class InstanceDetectorError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'InstanceDetectorError';
  }
}

/** Convert instance Map to JSON-safe Record for webview messaging. */
export function instanceMapToRecord(
  instances: Map<string, InstanceInfo>
): InstanceInfoMap {
  return Object.fromEntries(instances.entries());
}

/** Build a stable map key for a profile/project instance pair. */
export function buildInstanceKey(
  profileId: string,
  projectPath?: string
): string {
  return projectPath ? `${profileId}:${projectPath}` : profileId;
}

/** Return whether any running instance belongs to the profile. */
export function isProfilePresentInInstances(
  instances: Map<string, InstanceInfo> | InstanceInfoMap,
  profileId: string
): boolean {
  const values =
    instances instanceof Map
      ? instances.values()
      : Object.values(instances);

  for (const info of values) {
    if (info.profileId === profileId) {
      return true;
    }
  }

  return false;
}

/** Return project paths currently open for a profile across detected instances. */
export function getOpenProjectPathsForProfile(
  instances: InstanceInfoMap,
  profileId: string
): string[] {
  return Object.values(instances)
    .filter(
      (info) => info.profileId === profileId && info.projectPath != null
    )
    .map((info) => info.projectPath as string);
}

export class InstanceDetector implements IInstanceDetector {
  private pollTimer: NodeJS.Timeout | undefined;
  private lastDetection: Map<string, InstanceInfo> = new Map();
  private readonly processScanner: CursorProcessScanner;
  private onDetectionChangeCallbacks: Array<
    (instances: Map<string, InstanceInfo>) => void
  > = [];

  constructor(
    private readonly profileManager: IProfileReader,
    processProvider?: CursorProcessProvider
  ) {
    this.processScanner = new CursorProcessScanner(processProvider);
  }

  /** Register callback for detection updates (e.g. Accounts panel). */
  onDetectionChange(
    callback: (instances: Map<string, InstanceInfo>) => void
  ): void {
    this.onDetectionChangeCallbacks.push(callback);
  }

  /**
   * Detect all running Cursor instances and match to profiles.
   */
  async detectRunningInstances(): Promise<Map<string, InstanceInfo>> {
    try {
      const processes = await this.processScanner.scan();
      const profiles = await this.profileManager.getProfiles();

      const instances = new Map<string, InstanceInfo>();

      for (const proc of processes) {
        const profile = profiles.find(
          (p) =>
            proc.userDataDir &&
            pathsEqual(proc.userDataDir, p.userDataDir)
        );

        if (profile) {
          const instanceInfo: InstanceInfo = {
            profileId: profile.id,
            pid: proc.pid,
            startTime: proc.startTime,
            userDataDir: proc.userDataDir ?? profile.userDataDir,
            projectPath: proc.projectPath,
            detectedAt: Date.now(),
          };
          const key = buildInstanceKey(profile.id, proc.projectPath);
          instances.set(key, instanceInfo);
        }
      }

      const changed = !mapsEqual(this.lastDetection, instances);
      this.lastDetection = instances;

      if (changed) {
        extensionLog.debug(
          `[InstanceDetector] Running instances changed: ${instances.size} matched profile(s) from ${processes.length} process(es)`
        );
        this.notifyDetectionChange(instances);
      }

      return instances;
    } catch (error) {
      throw new InstanceDetectorError(
        'Failed to detect running instances',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Check if a specific profile is currently running.
   */
  async isProfileRunning(profileId: string): Promise<boolean> {
    const instances = await this.detectRunningInstances();
    return isProfilePresentInInstances(instances, profileId);
  }

  /**
   * Check if a profile is already running with the given project path.
   */
  async isProfileProjectRunning(
    profileId: string,
    projectPath: string
  ): Promise<boolean> {
    const instances = await this.detectRunningInstances();

    for (const info of instances.values()) {
      if (
        info.profileId === profileId &&
        info.projectPath != null &&
        pathsEqual(info.projectPath, projectPath)
      ) {
        return true;
      }
    }

    return false;
  }

  /** Return all detected instances for a profile. */
  getProfileInstances(profileId: string): InstanceInfo[] {
    return [...this.lastDetection.values()].filter(
      (info) => info.profileId === profileId
    );
  }

  /**
   * Find a main Cursor process using the given user data directory.
   */
  async findProcessByUserDataDir(
    userDataDir: string
  ): Promise<CursorProcess | undefined> {
    const processes = await this.processScanner.scan();
    return processes.find(
      (proc) =>
        proc.userDataDir != null && pathsEqual(proc.userDataDir, userDataDir)
    );
  }

  /**
   * Get last detected instances (cached).
   */
  getLastDetection(): Map<string, InstanceInfo> {
    return new Map(this.lastDetection);
  }

  /**
   * Start automatic detection with polling.
   */
  startAutoDetection(intervalMs = 30000): void {
    this.stopAutoDetection();

    void this.detectRunningInstances().catch((error) => {
      extensionLog.error(
        `[InstanceDetector] Initial instance detection failed: ${extensionLog.formatError(error)}`
      );
    });

    this.pollTimer = setInterval(() => {
      void this.detectRunningInstances().catch((error) => {
        extensionLog.error(
          `[InstanceDetector] Instance detection poll failed: ${extensionLog.formatError(error)}`
        );
      });
    }, intervalMs);
  }

  /**
   * Stop automatic detection.
   */
  stopAutoDetection(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
      extensionLog.debug('[InstanceDetector] Auto-detection stopped');
    }
  }

  private notifyDetectionChange(
    instances: Map<string, InstanceInfo>
  ): void {
    for (const callback of this.onDetectionChangeCallbacks) {
      try {
        callback(new Map(instances));
      } catch (error) {
        extensionLog.error(
          `[InstanceDetector] Instance detection callback failed: ${extensionLog.formatError(error)}`
        );
      }
    }
  }
}

function mapsEqual(
  a: Map<string, InstanceInfo>,
  b: Map<string, InstanceInfo>
): boolean {
  if (a.size !== b.size) {
    return false;
  }

  for (const [key, value] of a) {
    const other = b.get(key);
    if (
      !other ||
      other.pid !== value.pid ||
      other.projectPath !== value.projectPath
    ) {
      return false;
    }
  }

  return true;
}
