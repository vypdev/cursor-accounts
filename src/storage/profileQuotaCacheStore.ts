import type { Memento } from 'vscode';
import type {
  ActivityLeaderboardSnapshot,
  ProfileQuota,
} from '@cursor-accounts/types';
import type { IProfileQuotaCache } from '../domain/ports/IProfileQuotaCache';
import {
  deserializeLeaderboardCache,
  deserializeQuotaCache,
  serializeLeaderboardCache,
  serializeQuotaCache,
} from '../application/services/profileQuotaCachePolicy';

const QUOTA_CACHE_KEY = 'multiProfileQuotaCache';
const LEADERBOARD_CACHE_KEY = 'multiProfileLeaderboardCache';

/** VS Code global-state adapter for the profile quota cache. */
export class ProfileQuotaCacheStore implements IProfileQuotaCache {
  private quotaCacheWrite: Promise<void> = Promise.resolve();
  private leaderboardCacheWrite: Promise<void> = Promise.resolve();

  constructor(private readonly globalState: Memento) {}

  getQuota(profileId: string): ProfileQuota | undefined {
    return this.getAllQuotas().get(profileId);
  }

  getAllQuotas(): Map<string, ProfileQuota> {
    return deserializeQuotaCache(
      this.globalState.get<unknown>(QUOTA_CACHE_KEY)
    );
  }

  async saveQuotas(
    quotas: ReadonlyMap<string, ProfileQuota>
  ): Promise<void> {
    const write = this.quotaCacheWrite.then(async () => {
      await this.globalState.update(
        QUOTA_CACHE_KEY,
        serializeQuotaCache(quotas)
      );
    });
    this.quotaCacheWrite = write.catch(() => undefined);
    await write;
  }

  getLeaderboard(profileId: string): ActivityLeaderboardSnapshot | undefined {
    return deserializeLeaderboardCache(
      this.globalState.get<unknown>(LEADERBOARD_CACHE_KEY)
    ).get(profileId);
  }

  async saveLeaderboard(
    profileId: string,
    snapshot: ActivityLeaderboardSnapshot
  ): Promise<void> {
    const write = this.leaderboardCacheWrite.then(async () => {
      const existing = deserializeLeaderboardCache(
        this.globalState.get<unknown>(LEADERBOARD_CACHE_KEY)
      );
      existing.set(profileId, snapshot);
      await this.globalState.update(
        LEADERBOARD_CACHE_KEY,
        serializeLeaderboardCache(existing)
      );
    });
    this.leaderboardCacheWrite = write.catch(() => undefined);
    await write;
  }

  async clear(): Promise<void> {
    await this.globalState.update(QUOTA_CACHE_KEY, undefined);
    await this.globalState.update(LEADERBOARD_CACHE_KEY, undefined);
  }
}
