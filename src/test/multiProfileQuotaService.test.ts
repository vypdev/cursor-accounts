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

describe('MultiProfileQuotaService', () => {
  let tempDir: string;
  let configDir: string;
  let extensionPath: string;
  let manager: ProfileManager;
  let service: MultiProfileQuotaService;
  let mockContext: ReturnType<typeof createMockContext>;

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
    const authReader: IProfileAuthReader = {
      readTokens: async () => null,
    };
    const createQuotaService: QuotaServiceFactory = () =>
      ({
        getUsage: async () => {
          throw new Error('Not implemented in test');
        },
      }) as IQuotaService;
    const activityLeaderboardService: IActivityLeaderboardService = {
      fetchSnapshot: async () => ({
        entries: [],
        periodStart: '',
        periodEnd: '',
        fetchedAt: Date.now(),
      }),
    };
    service = new MultiProfileQuotaService(
      mockContext as never,
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
