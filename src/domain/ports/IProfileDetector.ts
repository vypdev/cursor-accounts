import type { Profile } from '@cursor-accounts/types';

/** Port for detecting the active Cursor profile in the current window. */
export interface IProfileDetector {
  detectCurrentProfile(): Promise<Profile | null>;
  getCurrentUserDataDir(): string;
  getDefaultCursorUserDataDir(): string;
  isDefaultProfile(): boolean;
  clearCache(): void;
  getProfileDescription(): Promise<string>;
}
