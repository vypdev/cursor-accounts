import type * as vscode from 'vscode';
import type { ActivityLeaderboardSnapshot } from '../domain';
import { isEnterpriseUsage } from '../domain';
import type { IActivityLeaderboardService } from '../domain/ports/IActivityLeaderboardService';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IQuotaService } from '../domain/ports/IQuotaService';
import type { ITokenProvider } from '../domain/ports/ITokenProvider';
import * as extensionLog from '../logging/extensionLog';
import { StaticTokenProvider } from '../auth/tokenProvider';
import type { Profile, ProfileQuota } from '../profiles/types';
import { validateUserDataPath } from '../utils/pathUtils';

const QUOTA_CACHE_KEY = 'multiProfileQuotaCache';
const LEADERBOARD_CACHE_KEY = 'multiProfileLeaderboardCache';
const CACHE_VALIDITY_MS = 5 * 60 * 1000;
const LEADERBOARD_CACHE_VALIDITY_MS = 15 * 60 * 1000;

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

export class MultiProfileQuotaService {
  private refreshTimer: NodeJS.Timeout | undefined;
  private inFlight = false;
  private onRefreshCallbacks: Array<
    (quotas: Map<string, ProfileQuota>) => void
  > = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileManager: IProfileManager,
    private readonly authReader: IProfileAuthReader,
    private readonly createQuotaService: QuotaServiceFactory,
    private readonly activityLeaderboardService: IActivityLeaderboardService
  ) {}

  /** Register callback for background quota updates (e.g. Accounts panel). */
  onRefresh(callback: (quotas: Map<string, ProfileQuota>) => void): void {
    this.onRefreshCallbacks.push(callback);
  }

  /** Start background refresh. */
  start(intervalSeconds = 300): void {
    this.stop();

    extensionLog.info(
      `[MultiProfileQuotaService] Started (interval ${intervalSeconds}s)`
    );
    void this.refreshAll();

    this.refreshTimer = setInterval(() => {
      void this.refreshAll();
    }, intervalSeconds * 1000);
  }

  /** Stop background refresh. */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
      extensionLog.debug('[MultiProfileQuotaService] Stopped');
    }
  }

  /** Fetch quotas for all profiles in parallel. */
  async fetchAllQuotas(): Promise<Map<string, ProfileQuota>> {
    const profiles = await this.profileManager.getProfiles();

    if (profiles.length === 0) {
      return new Map();
    }

    const results = await Promise.allSettled(
      profiles.map((profile) => this.fetchQuotaForProfile(profile))
    );

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
        const reason: unknown = result.reason;
        quotaMap.set(profile.id, {
          profileId: profile.id,
          quota: null,
          error:
            reason instanceof Error ? reason.message : 'Failed to fetch quota',
          fetchedAt: Date.now(),
        });
      }
    }

    await this.saveCache(quotaMap);
    return quotaMap;
  }

  /** Fetch quota for a single profile. */
  async fetchQuotaForProfile(profile: Profile): Promise<ProfileQuota> {
    try {
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
      const quota = await quotaClient.getUsage();

      let activityLeaderboard = null;
      if (quota && isEnterpriseUsage(quota)) {
        activityLeaderboard = await this.fetchActivityLeaderboard(
          tokens.accessToken,
          profile.id
        );
      }

      return {
        profileId: profile.id,
        quota,
        activityLeaderboard,
        fetchedAt: Date.now(),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      const authMessage = this.toAuthErrorMessage(message);

      return {
        profileId: profile.id,
        quota: null,
        error: authMessage,
        fetchedAt: Date.now(),
      };
    }
  }

  /** Refresh all quotas (with deduplication). */
  async refreshAll(): Promise<Map<string, ProfileQuota>> {
    if (this.inFlight) {
      extensionLog.debug(
        '[MultiProfileQuotaService] Refresh skipped (already in flight)'
      );
      return this.loadCache();
    }

    try {
      this.inFlight = true;
      const quotas = await this.fetchAllQuotas();
      let ok = 0;
      let failed = 0;
      for (const entry of quotas.values()) {
        if (entry.quota) {
          ok += 1;
        } else {
          failed += 1;
        }
      }
      extensionLog.info(
        `[MultiProfileQuotaService] Refresh complete: ${quotas.size} profile(s), ${ok} ok, ${failed} failed`
      );
      for (const callback of this.onRefreshCallbacks) {
        callback(quotas);
      }
      return quotas;
    } finally {
      this.inFlight = false;
    }
  }

  /** Get cached quota for a profile if still valid. */
  getCachedQuota(profileId: string): ProfileQuota | undefined {
    const cache = this.loadCache();
    const cached = cache.get(profileId);

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
    return this.loadCache();
  }

  /** Clear all cached quotas. */
  async clearCache(): Promise<void> {
    await this.context.globalState.update(QUOTA_CACHE_KEY, undefined);
    await this.context.globalState.update(LEADERBOARD_CACHE_KEY, undefined);
  }

  private getCachedLeaderboard(
    profileId: string
  ): ActivityLeaderboardSnapshot | undefined {
    const cached = this.context.globalState.get<
      Record<string, ActivityLeaderboardSnapshot>
    >(LEADERBOARD_CACHE_KEY);
    const snapshot = cached?.[profileId];
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
    const existing =
      this.context.globalState.get<Record<string, ActivityLeaderboardSnapshot>>(
        LEADERBOARD_CACHE_KEY
      ) ?? {};
    existing[profileId] = snapshot;
    await this.context.globalState.update(LEADERBOARD_CACHE_KEY, existing);
  }

  private async fetchActivityLeaderboard(
    accessToken: string,
    profileId: string
  ): Promise<ActivityLeaderboardSnapshot> {
    const cached = this.getCachedLeaderboard(profileId);
    if (cached) {
      return cached;
    }

    try {
      const snapshot = await this.activityLeaderboardService.fetchSnapshot(
        accessToken,
        AbortSignal.timeout(15_000)
      );
      await this.saveLeaderboardCache(profileId, snapshot);
      return snapshot;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      extensionLog.debug(
        `[MultiProfileQuotaService] Activity leaderboard failed: ${message}`
      );
      return {
        entries: [],
        periodStart: '',
        periodEnd: '',
        fetchedAt: Date.now(),
        error: message,
      };
    }
  }

  private toAuthErrorMessage(message: string): string {
    const lower = message.toLowerCase();
    if (
      lower.includes('401') ||
      lower.includes('expired') ||
      lower.includes('unauthorized')
    ) {
      return 'Authentication expired. Launch profile to sign in again.';
    }
    if (lower.includes('not signed in') || lower.includes('sign in')) {
      return 'Launch this profile and sign in to see quota.';
    }
    return message;
  }

  private async saveCache(quotas: Map<string, ProfileQuota>): Promise<void> {
    const array = Array.from(quotas.entries()).map(([id, quota]) => ({
      id,
      quota,
    }));

    await this.context.globalState.update(QUOTA_CACHE_KEY, array);
  }

  private loadCache(): Map<string, ProfileQuota> {
    const cached = this.context.globalState.get<
      Array<{ id: string; quota: ProfileQuota }>
    >(QUOTA_CACHE_KEY);

    if (!cached) {
      return new Map();
    }

    return new Map(cached.map((item) => [item.id, item.quota]));
  }
}

/** Convert quota Map to JSON-safe Record for webview messaging. */
export function quotaMapToRecord(
  quotas: Map<string, ProfileQuota>
): Record<string, ProfileQuota> {
  return Object.fromEntries(quotas.entries());
}
