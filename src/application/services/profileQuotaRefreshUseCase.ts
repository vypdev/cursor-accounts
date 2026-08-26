import type { Profile, ProfileQuota } from '@cursor-accounts/types';
import type { IProfileQuotaCache } from '../../domain/ports/IProfileQuotaCache';
import type { IProfileReader } from '../../domain/ports/IProfileReader';
import { createQuotaFailure } from './profileQuotaRefreshPolicy';

export interface ProfileQuotaFetchPort {
  fetch(profile: Profile, signal?: AbortSignal): Promise<ProfileQuota>;
}

export interface ProfileQuotaRefreshUseCaseDependencies {
  cache: IProfileQuotaCache;
  profileReader: IProfileReader;
  fetcher: ProfileQuotaFetchPort;
  now: () => number;
  logDebug(message: string): void;
}

/** Fetches and caches the quota read model for every configured profile. */
export class ProfileQuotaRefreshUseCase {
  private fetchGeneration = 0;

  constructor(
    private readonly dependencies: ProfileQuotaRefreshUseCaseDependencies
  ) {}

  async fetchAllQuotas(signal?: AbortSignal): Promise<Map<string, ProfileQuota>> {
    const generation = ++this.fetchGeneration;
    const profiles = await this.dependencies.profileReader.getProfiles();
    if (this.isSupersededOrAborted(generation, signal)) {
      return this.dependencies.cache.getAllQuotas();
    }

    if (profiles.length === 0) {
      return new Map();
    }

    const results = await Promise.allSettled(
      profiles.map((profile) => this.fetch(profile, signal))
    );
    if (this.isSupersededOrAborted(generation, signal)) {
      this.dependencies.logDebug(
        '[ProfileQuotaRefreshUseCase] Discarding superseded or cancelled quota fetch'
      );
      return this.dependencies.cache.getAllQuotas();
    }

    const quotas = buildQuotaMap(
      profiles,
      results,
      this.dependencies.now()
    );
    if (generation !== this.fetchGeneration) {
      return this.dependencies.cache.getAllQuotas();
    }

    await this.dependencies.cache.saveQuotas(quotas);
    return quotas;
  }

  fetch(profile: Profile, signal?: AbortSignal): Promise<ProfileQuota> {
    return this.dependencies.fetcher.fetch(profile, signal);
  }

  private isSupersededOrAborted(
    generation: number,
    signal: AbortSignal | undefined
  ): boolean {
    return Boolean(signal?.aborted) || generation !== this.fetchGeneration;
  }
}

function buildQuotaMap(
  profiles: Profile[],
  results: PromiseSettledResult<ProfileQuota>[],
  fetchedAt: number
): Map<string, ProfileQuota> {
  const quotaMap = new Map<string, ProfileQuota>();

  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index];
    const result = results[index];
    if (!profile || !result) {
      continue;
    }

    quotaMap.set(
      profile.id,
      result.status === 'fulfilled'
        ? result.value
        : createQuotaFailure(profile.id, result.reason, fetchedAt)
    );
  }

  return quotaMap;
}
