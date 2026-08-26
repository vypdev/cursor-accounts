import { summarizeQuotaRefresh } from '../application/services/profileQuotaRefreshPolicy';
import type { ProfileQuotaFetcher } from '../application/services/profileQuotaFetcher';
import { ProfileQuotaRefreshUseCase } from '../application/services/profileQuotaRefreshUseCase';
import type { IProfileQuotaCache } from '../domain/ports/IProfileQuotaCache';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import * as extensionLog from '../logging/extensionLog';
import type { Profile, ProfileQuota } from '../profiles/types';

export type { QuotaServiceFactory } from '../application/services/profileQuotaFetcher';

const CACHE_VALIDITY_MS = 5 * 60 * 1000;

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
  private readonly quotaRefreshUseCase: ProfileQuotaRefreshUseCase;

  constructor(
    private readonly cache: IProfileQuotaCache,
    profileManager: IProfileReader,
    fetcher: ProfileQuotaFetcher,
    now: () => number = () => Date.now()
  ) {
    this.quotaRefreshUseCase = new ProfileQuotaRefreshUseCase({
      cache,
      profileReader: profileManager,
      fetcher,
      now,
      logDebug: (message) => extensionLog.debug(message),
    });
  }

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
    return this.quotaRefreshUseCase.fetchAllQuotas(signal);
  }

  /** Fetch quota for a single profile. */
  async fetchQuotaForProfile(
    profile: Profile,
    signal?: AbortSignal
  ): Promise<ProfileQuota> {
    return this.quotaRefreshUseCase.fetch(profile, signal);
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

}

/** Convert quota Map to JSON-safe Record for webview messaging. */
export function quotaMapToRecord(
  quotas: Map<string, ProfileQuota>
): Record<string, ProfileQuota> {
  return Object.fromEntries(quotas.entries());
}
