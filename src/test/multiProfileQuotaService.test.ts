import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileStorage } from '../profiles/profileStorage';
import type { IActivityLeaderboardService } from '../domain/ports/IActivityLeaderboardService';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import type { IQuotaService } from '../domain/ports/IQuotaService';
import type { CursorAuthTokens, QuotaUsage } from '@cursor-accounts/types';
import { ProfileQuotaCacheStore } from '../storage/profileQuotaCacheStore';
import {
  MultiProfileQuotaService,
  type QuotaServiceFactory,
} from '../services/multiProfileQuotaService';

interface MockGlobalState {
  data: Record<string, unknown>;
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Promise<void>;
}

function createMockContext(extensionPath: string): {
  extensionPath: string;
  globalState: MockGlobalState;
} {
  const data: Record<string, unknown> = {};

  return {
    extensionPath,
    globalState: {
      data,
      get<T>(key: string): T | undefined {
        return data[key] as T | undefined;
      },
      async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
          delete data[key];
        } else {
          data[key] = value;
        }
      },
    },
  };
}

function createQuota(overrides: Partial<QuotaUsage> = {}): QuotaUsage {
  return {
    totalPercentUsed: 10,
    autoPercentUsed: 10,
    apiPercentUsed: 10,
    totalSpend: 100,
    includedSpend: 100,
    remaining: 900,
    limit: 1000,
    billingCycleStart: '2026-01-01',
    billingCycleEnd: '2026-02-01',
    fetchedAt: Date.now(),
    ...overrides,
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!condition() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(condition(), true);
}

describe('MultiProfileQuotaService', () => {
  let tempDir: string;
  let configDir: string;
  let extensionPath: string;
  let manager: ProfileManager;
  let service: MultiProfileQuotaService;
  let mockContext: ReturnType<typeof createMockContext>;
  let authReader: IProfileAuthReader;
  let createQuotaService: QuotaServiceFactory;
  let quotaServiceImplementation: QuotaServiceFactory;
  let activityLeaderboardService: IActivityLeaderboardService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-multi-profile-')
    );
    configDir = path.join(tempDir, 'config');
    extensionPath = path.join(tempDir, 'extension');
    await fs.mkdir(extensionPath, { recursive: true });

    const storage = new ProfileStorage(configDir);
    manager = new ProfileManager(storage);
    await manager.initialize();

    mockContext = createMockContext(extensionPath);
    authReader = {
      readTokens: async () => null,
    };
    quotaServiceImplementation = () =>
      ({
        getUsage: async () => {
          throw new Error('Not implemented in test');
        },
      }) as IQuotaService;
    createQuotaService = (provider) => quotaServiceImplementation(provider);
    activityLeaderboardService = {
      fetchSnapshot: async () => ({
        entries: [],
        periodStart: '',
        periodEnd: '',
        fetchedAt: Date.now(),
      }),
    };
    service = new MultiProfileQuotaService(
      new ProfileQuotaCacheStore(mockContext.globalState as never),
      manager,
      authReader,
      createQuotaService,
      activityLeaderboardService
    );
  });

  afterEach(async () => {
    service.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('fetchAllQuotas', () => {
    it('returns empty map when no profiles', async () => {
      const quotas = await service.fetchAllQuotas();
      assert.equal(quotas.size, 0);
    });

    it('returns map with profile IDs as keys', async () => {
      const profile = await manager.createProfile({
        email: 'test@example.com',
      });

      const quotas = await service.fetchAllQuotas();

      assert.ok(quotas.has(profile.id));
    });

    it('includes error for profiles without tokens', async () => {
      const profile = await manager.createProfile({
        email: 'test@example.com',
      });

      const quotas = await service.fetchAllQuotas();
      const quota = quotas.get(profile.id);

      assert.ok(quota);
      assert.equal(quota.quota, null);
      assert.ok(quota.error);
    });

    it('sets fetchedAt timestamp', async () => {
      await manager.createProfile({ email: 'test@example.com' });

      const before = Date.now();
      const quotas = await service.fetchAllQuotas();
      const after = Date.now();

      const quota = [...quotas.values()][0];
      assert.ok(quota);
      assert.ok(quota.fetchedAt >= before && quota.fetchedAt <= after);
    });

    it('caches results after fetch', async () => {
      const profile = await manager.createProfile({
        email: 'cached@example.com',
      });

      await service.fetchAllQuotas();
      const cached = await service.getAllCachedQuotas();

      assert.ok(cached.has(profile.id));
    });

    it('maps transport authentication failures to a recoverable profile row', async () => {
      const profile = await manager.createProfile({
        email: 'auth-error@example.com',
      });
      const tokens: CursorAuthTokens = { accessToken: 'access-token' };
      authReader.readTokens = async () => tokens;
      quotaServiceImplementation = () => ({
        getUsage: async () => {
          throw new Error('HTTP 401 Unauthorized');
        },
      });

      const quotas = await service.fetchAllQuotas();
      assert.equal(
        quotas.get(profile.id)?.error,
        'Authentication expired. Launch profile to sign in again.'
      );
    });

    it('preserves both enterprise leaderboard cache entries from parallel profiles', async () => {
      const profiles = await Promise.all([
        manager.createProfile({ email: 'enterprise-one@example.com' }),
        manager.createProfile({ email: 'enterprise-two@example.com' }),
      ]);
      authReader.readTokens = async () => ({ accessToken: 'access-token' });
      quotaServiceImplementation = () => ({
        getUsage: async () =>
          createQuota({ membershipType: 'enterprise', limitType: 'team' }),
      });
      activityLeaderboardService.fetchSnapshot = async () => ({
        entries: [],
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        fetchedAt: Date.now(),
      });

      await service.fetchAllQuotas();

      const cached = mockContext.globalState.data[
        'multiProfileLeaderboardCache'
      ] as Record<string, unknown>;
      assert.deepEqual(Object.keys(cached).sort(), profiles.map((p) => p.id).sort());
    });

    it('returns the existing in-flight refresh and notifies listeners once', async () => {
      await manager.createProfile({ email: 'deduplicated@example.com' });
      const deferred = createDeferred<QuotaUsage>();
      authReader.readTokens = async () => ({ accessToken: 'access-token' });
      quotaServiceImplementation = () => ({
        getUsage: async () => deferred.promise,
      });
      let notifications = 0;
      service.onRefresh(() => {
        notifications += 1;
      });

      const first = service.refreshAll();
      const second = service.refreshAll();
      assert.equal(first, second);
      deferred.resolve(createQuota());

      await first;
      assert.equal(notifications, 1);
    });

    it('cancels a background refresh on stop without publishing partial data', async () => {
      await manager.createProfile({ email: 'cancelled@example.com' });
      authReader.readTokens = async () => ({ accessToken: 'access-token' });
      let receivedSignal: AbortSignal | undefined;
      quotaServiceImplementation = () => ({
        getUsage: async (signal) => {
          receivedSignal = signal;
          await new Promise<void>((resolve) => {
            signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          throw new Error('aborted');
        },
      });
      let notifications = 0;
      service.onRefresh(() => {
        notifications += 1;
      });

      service.start(60);
      await waitFor(() => receivedSignal !== undefined);
      const refresh = service.refreshAll();
      service.stop();

      const quotas = await refresh;
      assert.equal(quotas.size, 0);
      assert.equal(receivedSignal?.aborted, true);
      assert.equal(notifications, 0);
      assert.equal(service.getAllCachedQuotas().size, 0);
    });

    it('isolates failing listeners and supports deterministic unsubscribe', async () => {
      let notifications = 0;
      service.onRefresh(() => {
        throw new Error('listener failed');
      });
      const unsubscribe = service.onRefresh(() => {
        notifications += 1;
      });

      await service.refreshAll();
      assert.equal(notifications, 1);

      unsubscribe();
      await service.refreshAll();
      assert.equal(notifications, 1);
    });
  });

  describe('getCachedQuota', () => {
    it('returns undefined for non-existent profile', async () => {
      const cached = await service.getCachedQuota('non-existent');
      assert.equal(cached, undefined);
    });

    it('returns cached entry when within validity window', async () => {
      const profile = await manager.createProfile({
        email: 'valid-cache@example.com',
      });

      await service.fetchAllQuotas();
      const cached = await service.getCachedQuota(profile.id);

      assert.ok(cached);
      assert.equal(cached.profileId, profile.id);
    });
  });

  describe('clearCache', () => {
    it('clears cached quotas', async () => {
      await manager.createProfile({ email: 'clear@example.com' });
      await service.fetchAllQuotas();

      await service.clearCache();

      const cached = await service.getAllCachedQuotas();
      assert.equal(cached.size, 0);
    });

    it('ignores malformed persisted cache values', () => {
      mockContext.globalState.data.multiProfileQuotaCache = [
        { id: 'missing-quota' },
        { id: 'wrong-shape', quota: 'invalid' },
      ];

      assert.equal(service.getAllCachedQuotas().size, 0);
    });
  });

  describe('lifecycle', () => {
    it('clears refresh timer on stop', () => {
      service.start(60);
      service.stop();
      service.start(60);
      service.stop();
    });
  });
});
