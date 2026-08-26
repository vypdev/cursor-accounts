import type { ActivityLeaderboardSnapshot } from '../domain';
import { isEnterpriseUsage } from '../domain';
import {
  createLeaderboardFailure,
  createQuotaFailure,
  mapQuotaAuthError,
  summarizeQuotaRefresh,
} from '../application/services/profileQuotaRefreshPolicy';
import type { IActivityLeaderboardService } from '../domain/ports/IActivityLeaderboardService';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import type { IProfileQuotaCache } from '../domain/ports/IProfileQuotaCache';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { IQuotaService } from '../domain/ports/IQuotaService';
import type { ITokenProvider } from '../domain/ports/ITokenProvider';
import * as extensionLog from '../logging/extensionLog';
import { StaticTokenProvider } from '../auth/tokenProvider';
import type { Profile, ProfileQuota } from '../profiles/types';
import { validateUserDataPath } from '../utils/pathUtils';

const CACHE_VALIDITY_MS = 5 * 60 * 1000;
const LEADERBOARD_CACHE_VALIDITY_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

export class MultiProfileQuotaServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'MultiProfileQuotaServiceError';
  }
}

export type QuotaServiceFactory = (provider: ITokenProvider) => IQuotaService;
export type QuotaRefreshCallback = (
  quotas: Map<string, ProfileQuota>
) => void | Promise<void>;

interface RefreshInFlight {
  generation: number;
  promise: Promise<Map<string, ProfileQuota>>;
}

export class MultiProfileQuotaService {
  private refreshTimer: NodeJS.Timeout | undefined;
  private backgroundAbortController: AbortController | undefined;
  private refreshGeneration = 0;
  private refreshInFlight: RefreshInFlight | undefined;
  private readonly onRefreshCallbacks = new Set<QuotaRefreshCallback>();
  private quotaFetchGeneration = 0;

  constructor(
    private readonly cache: IProfileQuotaCache,
    private readonly profileManager: IProfileReader,
    private readonly authReader: IProfileAuthReader,
    private readonly createQuotaService: QuotaServiceFactory,
    private readonly activityLeaderboardService: IActivityLeaderboardService
  ) {}

  /** Register callback for background quota updates (e.g. Accounts panel). */
  onRefresh(callback: QuotaRefreshCallback): () => void {
    this.onRefreshCallbacks.add(callback);
    return () => {
      this.onRefreshCallbacks.delete(callback);
    };
  }

  /** Start background refresh. */
  start(intervalSeconds = 300): void {
    this.stop();
    this.backgroundAbortController = new AbortController();

    extensionLog.info(
      `[MultiProfileQuotaService] Started (interval ${intervalSeconds}s)`
    );
    this.triggerRefresh();

    this.refreshTimer = setInterval(() => {
      this.triggerRefresh();
    }, intervalSeconds * 1000);
  }

  /** Stop background refresh. */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.backgroundAbortController?.abort();
    this.backgroundAbortController = undefined;
    this.refreshGeneration += 1;
    extensionLog.debug('[MultiProfileQuotaService] Stopped');
  }

  /** Fetch quotas for all profiles in parallel. */
  async fetchAllQuotas(signal?: AbortSignal): Promise<Map<string, ProfileQuota>> {
    const fetchGeneration = ++this.quotaFetchGeneration;
    const profiles = await this.profileManager.getProfiles();
    if (
      signal?.aborted ||
      fetchGeneration !== this.quotaFetchGeneration
    ) {
      return this.cache.getAllQuotas();
    }

    if (profiles.length === 0) {
      return new Map();
    }

    const results = await Promise.allSettled(
      profiles.map((profile) => this.fetchQuotaForProfile(profile, signal))
    );

    if (signal?.aborted || fetchGeneration !== this.quotaFetchGeneration) {
      extensionLog.debug(
        '[MultiProfileQuotaService] Discarding superseded or cancelled quota fetch'
      );
      return this.cache.getAllQuotas();
    }

    const quotaMap = new Map<string, ProfileQuota>();

    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      const result = results[i];
      if (!profile || !result) {
        continue;
      }

      if (result.status === 'fulfilled') {
        quotaMap.set(profile.id, result.value);
      } else {
        quotaMap.set(profile.id, createQuotaFailure(profile.id, result.reason, Date.now()));
      }
    }

    if (fetchGeneration !== this.quotaFetchGeneration) {
      return this.cache.getAllQuotas();
    }
    await this.saveCache(quotaMap);
    return quotaMap;
  }

  /** Fetch quota for a single profile. */
  async fetchQuotaForProfile(
    profile: Profile,
    signal?: AbortSignal
  ): Promise<ProfileQuota> {
    try {
      throwIfAborted(signal);
      const pathValidation = validateUserDataPath(profile.userDataDir);
      if (!pathValidation.valid) {
        return {
          profileId: profile.id,
          quota: null,
          error: pathValidation.error ?? 'Invalid profile path',
          fetchedAt: Date.now(),
        };
      }

      const tokens = await this.authReader.readTokens(profile.userDataDir);
      throwIfAborted(signal);

      if (!tokens?.accessToken) {
        return {
          profileId: profile.id,
          quota: null,
          error: 'No authentication tokens found. Launch profile to sign in.',
          fetchedAt: Date.now(),
        };
      }

      const tokenProvider = new StaticTokenProvider(tokens);
      const quotaClient = this.createQuotaService(tokenProvider);
      const quota = await quotaClient.getUsage(
        createRequestSignal(signal, REQUEST_TIMEOUT_MS)
      );
      throwIfAborted(signal);

      let activityLeaderboard = null;
      if (quota && isEnterpriseUsage(quota)) {
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
        fetchedAt: Date.now(),
      };
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      const authMessage = mapQuotaAuthError(message);

      return {
        profileId: profile.id,
        quota: null,
        error: authMessage,
        fetchedAt: Date.now(),
      };
    }
  }

  /** Refresh all quotas (with deduplication). */
  refreshAll(): Promise<Map<string, ProfileQuota>> {
    const generation = this.refreshGeneration;
    const existing = this.refreshInFlight;
    if (existing?.generation === generation) {
      extensionLog.debug(
        '[MultiProfileQuotaService] Refresh skipped (already in flight)'
      );
      return existing.promise;
    }

    const promise = this.performRefresh(
      this.backgroundAbortController?.signal
    );
    const refreshInFlight: RefreshInFlight = { generation, promise };
    this.refreshInFlight = refreshInFlight;
    void promise.then(
      () => this.clearRefreshInFlight(refreshInFlight),
      () => this.clearRefreshInFlight(refreshInFlight)
    );
    return promise;
  }

  /** Get cached quota for a profile if still valid. */
  getCachedQuota(profileId: string): ProfileQuota | undefined {
    const cached = this.cache.getQuota(profileId);

    if (!cached) {
      return undefined;
    }

    const age = Date.now() - cached.fetchedAt;
    if (age > CACHE_VALIDITY_MS) {
      return undefined;
    }

    return cached;
  }

  /** Get all cached quotas regardless of age. */
  getAllCachedQuotas(): Map<string, ProfileQuota> {
    return this.cache.getAllQuotas();
  }

  /** Clear all cached quotas. */
  async clearCache(): Promise<void> {
    await this.cache.clear();
  }

  private async performRefresh(
    signal: AbortSignal | undefined
  ): Promise<Map<string, ProfileQuota>> {
    const quotas = await this.fetchAllQuotas(signal);
    if (signal?.aborted) {
      extensionLog.debug(
        '[MultiProfileQuotaService] Background refresh cancelled'
      );
      return this.cache.getAllQuotas();
    }

    const summary = summarizeQuotaRefresh(quotas);
    extensionLog.info(
      `[MultiProfileQuotaService] Refresh complete: ${summary.total} profile(s), ${summary.successful} ok, ${summary.failed} failed`
    );
    await this.notifyRefreshCallbacks(quotas);
    return quotas;
  }

  private triggerRefresh(): void {
    void this.refreshAll().catch((error: unknown) => {
      extensionLog.error(
        `[MultiProfileQuotaService] Background refresh failed: ${extensionLog.formatError(error)}`
      );
    });
  }

  private clearRefreshInFlight(refreshInFlight: RefreshInFlight): void {
    if (this.refreshInFlight === refreshInFlight) {
      this.refreshInFlight = undefined;
    }
  }

  private async notifyRefreshCallbacks(
    quotas: Map<string, ProfileQuota>
  ): Promise<void> {
    await Promise.all(
      Array.from(this.onRefreshCallbacks, async (callback) => {
        try {
          await callback(quotas);
        } catch (error) {
          extensionLog.debug(
            `[MultiProfileQuotaService] Refresh callback failed: ${extensionLog.formatError(error)}`
          );
        }
      })
    );
  }

  private getCachedLeaderboard(
    profileId: string
  ): ActivityLeaderboardSnapshot | undefined {
    const snapshot = this.cache.getLeaderboard(profileId);
    if (!snapshot) {
      return undefined;
    }
    const age = Date.now() - snapshot.fetchedAt;
    if (age > LEADERBOARD_CACHE_VALIDITY_MS) {
      return undefined;
    }
    return snapshot;
  }

  private async saveLeaderboardCache(
    profileId: string,
    snapshot: ActivityLeaderboardSnapshot
  ): Promise<void> {
    await this.cache.saveLeaderboard(profileId, snapshot);
  }

  private async fetchActivityLeaderboard(
    accessToken: string,
    profileId: string,
    signal?: AbortSignal
  ): Promise<ActivityLeaderboardSnapshot> {
    throwIfAborted(signal);
    const cached = this.getCachedLeaderboard(profileId);
    if (cached) {
      return cached;
    }

    try {
      const snapshot = await this.activityLeaderboardService.fetchSnapshot(
        accessToken,
        createRequestSignal(signal, REQUEST_TIMEOUT_MS)
      );
      throwIfAborted(signal);
      await this.saveLeaderboardCache(profileId, snapshot);
      return snapshot;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      extensionLog.debug(
        `[MultiProfileQuotaService] Activity leaderboard failed: ${message}`
      );
      return createLeaderboardFailure(message, Date.now());
    }
  }

  private async saveCache(quotas: Map<string, ProfileQuota>): Promise<void> {
    await this.cache.saveQuotas(quotas);
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

/** Convert quota Map to JSON-safe Record for webview messaging. */
export function quotaMapToRecord(
  quotas: Map<string, ProfileQuota>
): Record<string, ProfileQuota> {
  return Object.fromEntries(quotas.entries());
}
