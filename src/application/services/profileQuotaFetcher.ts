import type {
  ActivityLeaderboardSnapshot,
  CursorAuthTokens,
  Profile,
  ProfileQuota,
} from '@cursor-accounts/types';
import { isEnterpriseUsage } from '@cursor-accounts/types';
import type { IActivityLeaderboardService } from '../../domain/ports/IActivityLeaderboardService';
import type { IProfileAuthReader } from '../../domain/ports/IProfileAuthReader';
import type { IProfileQuotaCache } from '../../domain/ports/IProfileQuotaCache';
import type { IQuotaService } from '../../domain/ports/IQuotaService';
import type { ITokenProvider } from '../../domain/ports/ITokenProvider';
import {
  createLeaderboardFailure,
  mapQuotaAuthError,
} from './profileQuotaRefreshPolicy';

const LEADERBOARD_CACHE_VALIDITY_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

export type QuotaServiceFactory = (provider: ITokenProvider) => IQuotaService;
export type TokenProviderFactory = (
  tokens: CursorAuthTokens
) => ITokenProvider;

export interface ProfilePathValidation {
  valid: boolean;
  error?: string;
}

export interface ProfileQuotaFetcherDependencies {
  authReader: IProfileAuthReader;
  cache: IProfileQuotaCache;
  createQuotaService: QuotaServiceFactory;
  createTokenProvider: TokenProviderFactory;
  activityLeaderboardService: IActivityLeaderboardService;
  validateProfilePath(userDataDir: string): ProfilePathValidation;
  now?: () => number;
}

/** Fetches one profile's quota and its optional enterprise leaderboard. */
export class ProfileQuotaFetcher {
  private readonly now: () => number;

  constructor(private readonly dependencies: ProfileQuotaFetcherDependencies) {
    this.now = dependencies.now ?? (() => Date.now());
  }

  async fetch(
    profile: Profile,
    signal?: AbortSignal
  ): Promise<ProfileQuota> {
    try {
      throwIfAborted(signal);
      const pathValidation = this.dependencies.validateProfilePath(
        profile.userDataDir
      );
      if (!pathValidation.valid) {
        return this.failure(
          profile.id,
          pathValidation.error ?? 'Invalid profile path'
        );
      }

      const tokens = await this.dependencies.authReader.readTokens(
        profile.userDataDir
      );
      throwIfAborted(signal);

      if (!tokens?.accessToken) {
        return this.failure(
          profile.id,
          'No authentication tokens found. Launch profile to sign in.'
        );
      }

      const tokenProvider = this.dependencies.createTokenProvider(tokens);
      const quotaClient = this.dependencies.createQuotaService(tokenProvider);
      const quota = await quotaClient.getUsage(
        createRequestSignal(signal, REQUEST_TIMEOUT_MS)
      );
      throwIfAborted(signal);

      let activityLeaderboard: ActivityLeaderboardSnapshot | null = null;
      if (isEnterpriseUsage(quota)) {
        activityLeaderboard = await this.fetchActivityLeaderboard(
          tokens.accessToken,
          profile.id,
          signal
        );
      }
      throwIfAborted(signal);

      return {
        profileId: profile.id,
        quota,
        activityLeaderboard,
        fetchedAt: this.now(),
      };
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return this.failure(profile.id, mapQuotaAuthError(message));
    }
  }

  private async fetchActivityLeaderboard(
    accessToken: string,
    profileId: string,
    signal?: AbortSignal
  ): Promise<ActivityLeaderboardSnapshot> {
    throwIfAborted(signal);
    const cached = this.dependencies.cache.getLeaderboard(profileId);
    if (cached && this.isFreshLeaderboard(cached)) {
      return cached;
    }

    try {
      const snapshot =
        await this.dependencies.activityLeaderboardService.fetchSnapshot(
          accessToken,
          createRequestSignal(signal, REQUEST_TIMEOUT_MS)
        );
      throwIfAborted(signal);
      await this.dependencies.cache.saveLeaderboard(profileId, snapshot);
      return snapshot;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return createLeaderboardFailure(message, this.now());
    }
  }

  private isFreshLeaderboard(snapshot: ActivityLeaderboardSnapshot): boolean {
    return this.now() - snapshot.fetchedAt <= LEADERBOARD_CACHE_VALIDITY_MS;
  }

  private failure(profileId: string, error: string): ProfileQuota {
    return {
      profileId,
      quota: null,
      error,
      fetchedAt: this.now(),
    };
  }
}

function createRequestSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return parentSignal
    ? AbortSignal.any([parentSignal, timeoutSignal])
    : timeoutSignal;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('Operation aborted');
}
