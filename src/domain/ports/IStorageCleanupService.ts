import type {
  StorageCleanupOptions,
  StorageCleanupResult,
} from '@cursor-accounts/types';

/** Port for profile storage cleanup orchestration. */
export interface IStorageCleanupService {
  /** Run a cleanup action for the given profile. */
  cleanProfileStorage(
    profileId: string,
    options: StorageCleanupOptions
  ): Promise<StorageCleanupResult>;
}
