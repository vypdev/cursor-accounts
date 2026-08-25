import type { Profile } from '@cursor-accounts/types';

/** Read-only profile queries for application services and adapters. */
export interface IProfileReader {
  getProfiles(): Promise<Profile[]>;
  getProfile(id: string): Promise<Profile | undefined>;
  findProfileByEmail(email: string): Promise<Profile | undefined>;
  findProfileByPath(userDataDir: string): Promise<Profile | undefined>;
}
