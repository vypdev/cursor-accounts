import type {
  CreateProfileOptions,
  Profile,
  ValidationResult,
} from '@cursor-accounts/types';
import type { IInstanceDetector } from './IInstanceDetector';
import type { IProfileWriter } from './IProfileWriter';

/** Port for profile configuration CRUD and validation. */
export interface IProfileManager extends IProfileWriter {
  initialize(): Promise<void>;
  createProfile(options: CreateProfileOptions): Promise<Profile>;
  deleteProfile(id: string, instanceDetector?: IInstanceDetector): Promise<void>;
  validateEmail(email: string): ValidationResult;
  isProfilePathValid(userDataDir: string): Promise<boolean>;
  backup(): Promise<string>;
  getStats(): Promise<{
    totalProfiles: number;
    profilesWithTheme: number;
    averageAge: number;
  }>;
}
