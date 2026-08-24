import type { InstanceInfo } from '@cursor-accounts/types';

/** Port for detecting running Cursor instances and matching them to profiles. */
export interface IInstanceDetector {
  onDetectionChange(
    callback: (instances: Map<string, InstanceInfo>) => void
  ): void;
  detectRunningInstances(): Promise<Map<string, InstanceInfo>>;
  isProfileRunning(profileId: string): Promise<boolean>;
  isProfileProjectRunning(
    profileId: string,
    projectPath: string
  ): Promise<boolean>;
  getProfileInstances(profileId: string): InstanceInfo[];
  findProcessByUserDataDir(userDataDir: string): Promise<
    | {
        pid: number;
        userDataDir?: string;
        startTime?: number;
      }
    | undefined
  >;
  getLastDetection(): Map<string, InstanceInfo>;
  startAutoDetection(intervalMs?: number): void;
  stopAutoDetection(): void;
}
