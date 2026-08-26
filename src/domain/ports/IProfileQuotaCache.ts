import type {
  ActivityLeaderboardSnapshot,
  ProfileQuota,
} from '@cursor-accounts/types';

/** Persistence port for the multi-profile quota read model. */
export interface IProfileQuotaCache {
  getQuota(profileId: string): ProfileQuota | undefined;
  getAllQuotas(): Map<string, ProfileQuota>;
  saveQuotas(quotas: ReadonlyMap<string, ProfileQuota>): Promise<void>;
  getLeaderboard(profileId: string): ActivityLeaderboardSnapshot | undefined;
  saveLeaderboard(
    profileId: string,
    snapshot: ActivityLeaderboardSnapshot
  ): Promise<void>;
  clear(): Promise<void>;
}
