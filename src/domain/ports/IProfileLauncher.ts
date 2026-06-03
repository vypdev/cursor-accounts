import type { Profile } from '@cursor-accounts/types';

/** Result of launching a Cursor instance for a profile. */
export interface ProfileLaunchResult {
  success: boolean;
  pid?: number;
  error?: string;
}

/** Options when launching a profile. */
export interface ProfileLaunchOptions {
  /** Bypass running-instance check. Can cause data corruption if profile is open. */
  force?: boolean;
  /** Optional folder or workspace file path to open in the new window. */
  projectPath?: string;
}

/** Port for launching Cursor instances with profile isolation. */
export interface IProfileLauncher {
  launch(
    profileId: string,
    options?: ProfileLaunchOptions
  ): Promise<ProfileLaunchResult>;
  forceLaunch(profileId: string): Promise<ProfileLaunchResult>;
  launchWithPath(
    profileId: string,
    projectPath: string
  ): Promise<ProfileLaunchResult>;
  waitForInstance(
    userDataDir: string,
    timeoutMs?: number,
    intervalMs?: number
  ): Promise<number | undefined>;
  getAppBundlePath(): string;
  getExecutablePath(): string;
  buildLaunchArgs(
    userDataDir: string,
    projectPath?: string,
    options?: { proxyUrl?: string }
  ): string[];
  buildLaunchCommand(profile: Profile): string[];
  validateExecutable(): Promise<{ valid: boolean; error?: string }>;
}
