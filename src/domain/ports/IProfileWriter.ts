import type { Profile } from '@cursor-accounts/types';
import type { IProfileReader } from './IProfileReader';

/** Port for updating existing profile configuration. */
export interface IProfileWriter extends IProfileReader {
  updateProfile(id: string, updates: Partial<Profile>): Promise<Profile>;
}
