import type {
  CreateProfileOptions,
  Profile,
  ValidationResult,
} from '@cursor-accounts/types';
import type { IInstanceDetector } from './IInstanceDetector';
import type { IProfileReader } from './IProfileReader';

/** Port for profile configuration CRUD and validation. */
export interface IProfileManager extends IProfileReader {
  initialize(): Promise<void>;
  getProfiles(): Promise<Profile[]>;
  getProfile(id: string): Promise<Profile | undefined>;
  findProfileByEmail(email: string): Promise<Profile | undefined>;
  findProfileByPath(userDataDir: string): Promise<Profile | undefined>;
  createProfile(options: CreateProfileOptions): Promise<Profile>;
  updateProfile(id: string, updates: Partial<Profile>): Promise<Profile>;
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
