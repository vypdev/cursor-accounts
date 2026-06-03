import type { StorageBreakdown } from '@cursor-accounts/types';

/** Port for calculating on-disk storage used by a Cursor profile. */
export interface IProfileStorageAnalyzer {
  calculateProfileStorageSize(
    profileId: string,
    userDataDir: string
  ): Promise<StorageBreakdown>;

  /** Total bytes for before/after cleanup comparisons. */
  getProfileTotalBytes(userDataDir: string): Promise<number>;
}
