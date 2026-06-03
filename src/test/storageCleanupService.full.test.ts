import './registerVscodeMock';
import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import type { ICacheCleanupService } from '../domain/ports/ICacheCleanupService';
import type { IDatabaseCleanupService } from '../domain/ports/IDatabaseCleanupService';
import type { IProfileStorageAnalyzer } from '../domain/ports/IProfileStorageAnalyzer';
import { initL10nForTests } from '../l10n';
import type { InstanceDetector } from '../profiles/instanceDetector';
import type { ProfileDetector } from '../profiles/profileDetector';
import type { ProfileManager } from '../profiles/profileManager';
import { StorageCleanupService } from '../services/storageCleanupService';

const MESSAGES: Record<string, string> = {
  'errors.profileNotFound': 'Profile not found',
  'storageCleanup.profileNotFound': 'Profile not found',
  'storageCleanup.extensionCacheCleared': 'Extension cache cleared',
  'storageCleanup.deleteOldChatsCurrentWindowOnly':
    'Delete old chats is only available for the profile open in this window.',
  'storageCleanup.deleteOldChatsStarted': 'Delete old chats started ({days} days)',
  'storageCleanup.deleteOldChatsManual': 'Run manually ({days} days)',
  'storageCleanup.commandUnavailable': 'Command unavailable',
  'storageCleanup.gcCurrentWindowOnly':
    'GC is only available for the profile open in this window.',
  'storageCleanup.gcStarted': 'GC started',
  'storageCleanup.gcManual': 'Run GC manually',
  'storageCleanup.profileRunning': 'Profile is running',
  'storageCleanup.editorCacheCleared': 'Editor cache cleared ({amount})',
  'storageCleanup.vacuumCompleted': 'Vacuum completed',
  'storageCleanup.deepCleanCompleted': 'Deep clean completed ({amount})',
  'storageCleanup.freedSpace': 'Freed {amount}',
  'storageCleanup.invalidPath': 'Invalid path',
  'storageCleanup.unknownAction': 'Unknown action',
  'errors.unknown': 'Unknown error',
};

function createMockProfile(userDataDir: string) {
  return {
    id: 'p1',
    slug: 'work',
    email: 'user@example.com',
    displayName: 'Work',
    userDataDir,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    created: '2024-01-01T00:00:00.000Z',
  };
}

function createService(overrides: {
  profileManager?: Partial<ProfileManager>;
  profileDetector?: Partial<ProfileDetector>;
  instanceDetector?: Partial<InstanceDetector>;
  storageAnalyzer?: Partial<IProfileStorageAnalyzer>;
  cacheCleanup?: Partial<ICacheCleanupService>;
  databaseCleanup?: Partial<IDatabaseCleanupService>;
} = {}): StorageCleanupService {
  const userDataDir = path.join(os.homedir(), '.cursor-test-profile-full');

  return new StorageCleanupService({
    profileManager: {
      getProfile: async () => createMockProfile(userDataDir),
      ...overrides.profileManager,
    } as unknown as ProfileManager,
    profileDetector: {
      detectCurrentProfile: async () => null,
      ...overrides.profileDetector,
    } as unknown as ProfileDetector,
    instanceDetector: {
      isProfileRunning: async () => false,
      ...overrides.instanceDetector,
    } as unknown as InstanceDetector,
    storageAnalyzer: {
      getProfileTotalBytes: async () => 1000,
      calculateProfileStorageSize: async () => ({
        profileId: 'p1',
        databaseBytes: 1000,
        walBytes: 0,
        workspaceStorageBytes: 0,
        editorCacheBytes: 0,
        extensionCacheBytes: 0,
        efficiencyDbBytes: 0,
        totalBytes: 1000,
      }),
      ...overrides.storageAnalyzer,
    },
    cacheCleanup: {
      cleanExtensionCache: async () => undefined,
      cleanEditorCache: async () => 256,
      deleteOldChats: async () => false,
      gcAgentKvBlobs: async () => false,
      ...overrides.cacheCleanup,
    },
    databaseCleanup: {
      vacuum: async () => undefined,
      deepClean: async () => ({
        backupPath: '/tmp/backup',
        bytesReclaimed: 512,
      }),
      ...overrides.databaseCleanup,
    },
    extensionPath: path.join(__dirname, '..', '..'),
  });
}

describe('StorageCleanupService full coverage', () => {
  beforeEach(() => {
    initL10nForTests(MESSAGES);
  });

  it('returns profile not found when profile is missing', async () => {
    const service = createService({
      profileManager: { getProfile: async () => undefined },
    });

    const result = await service.cleanProfileStorage('missing', {
      action: 'cleanExtensionCache',
    });

    assert.equal(result.success, false);
    assert.match(result.message, /Profile not found/);
  });

  it('rejects unsafe user data paths', async () => {
    const service = createService({
      profileManager: {
        getProfile: async () =>
          createMockProfile(
            process.platform === 'win32'
              ? 'C:\\Windows\\Temp\\cursor'
              : '/etc/cursor'
          ),
      },
    });

    const result = await service.cleanProfileStorage('p1', {
      action: 'cleanExtensionCache',
    });

    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  it('clears extension cache successfully', async () => {
    const cleanExtensionCache = mock.fn(async () => undefined);
    const service = createService({ cacheCleanup: { cleanExtensionCache } });

    const result = await service.cleanProfileStorage('p1', {
      action: 'cleanExtensionCache',
    });

    assert.equal(result.success, true);
    assert.equal(cleanExtensionCache.mock.callCount(), 1);
  });

  it('starts delete-old-chats when profile is current window', async () => {
    const userDataDir = path.join(os.homedir(), '.cursor-test-profile-full');
    const service = createService({
      profileDetector: {
        detectCurrentProfile: async () => createMockProfile(userDataDir),
      },
      cacheCleanup: {
        deleteOldChats: async () => true,
      },
    });

    const result = await service.cleanProfileStorage('p1', {
      action: 'deleteOldChats',
      chatAgeDays: 7,
    });

    assert.equal(result.success, true);
    assert.match(result.message, /started/i);
  });

  it('blocks delete-old-chats when profile is not current window', async () => {
    const service = createService();

    const result = await service.cleanProfileStorage('p1', {
      action: 'deleteOldChats',
      chatAgeDays: 30,
    });

    assert.equal(result.success, false);
    assert.match(result.message, /this window/i);
  });

  it('runs gc agent kv when profile is current window', async () => {
    const userDataDir = path.join(os.homedir(), '.cursor-test-profile-full');
    const service = createService({
      profileDetector: {
        detectCurrentProfile: async () => createMockProfile(userDataDir),
      },
      cacheCleanup: {
        gcAgentKvBlobs: async () => true,
      },
    });

    const result = await service.cleanProfileStorage('p1', {
      action: 'gcAgentKvBlobs',
    });

    assert.equal(result.success, true);
  });

  it('cleans editor cache when profile is closed', async () => {
    const cleanEditorCache = mock.fn(async () => 128);
    const service = createService({ cacheCleanup: { cleanEditorCache } });

    const result = await service.cleanProfileStorage('p1', {
      action: 'cleanEditorCache',
    });

    assert.equal(result.success, true);
    assert.equal(cleanEditorCache.mock.callCount(), 1);
  });

  it('blocks editor cache cleanup when profile is running', async () => {
    const service = createService({
      instanceDetector: { isProfileRunning: async () => true },
    });

    const result = await service.cleanProfileStorage('p1', {
      action: 'cleanEditorCache',
    });

    assert.equal(result.success, false);
    assert.match(result.message, /running/i);
  });

  it('vacuums database when profile is closed', async () => {
    const vacuum = mock.fn(async () => undefined);
    const service = createService({ databaseCleanup: { vacuum } });

    const result = await service.cleanProfileStorage('p1', {
      action: 'vacuumDatabase',
    });

    assert.equal(result.success, true);
    assert.equal(vacuum.mock.callCount(), 1);
  });

  it('deep cleans database and reports reclaimed bytes', async () => {
    const deepClean = mock.fn(async () => ({
      backupPath: '/tmp/state.vscdb.backup-1',
      bytesReclaimed: 4096,
    }));
    const service = createService({ databaseCleanup: { deepClean } });

    const result = await service.cleanProfileStorage('p1', {
      action: 'deepCleanDatabase',
    });

    assert.equal(result.success, true);
    assert.equal(deepClean.mock.callCount(), 1);
    assert.match(result.message, /Deep clean completed/);
    assert.equal(result.bytesReclaimed, 4096);
  });

  it('skips filesystem measurement for cleanExtensionCache', async () => {
    const getProfileTotalBytes = mock.fn(async () => 1000);
    const service = createService({
      storageAnalyzer: {
        getProfileTotalBytes,
        calculateProfileStorageSize: async () => ({
          profileId: 'p1',
          databaseBytes: 1000,
          walBytes: 0,
          workspaceStorageBytes: 0,
          editorCacheBytes: 0,
          extensionCacheBytes: 0,
          efficiencyDbBytes: 0,
          totalBytes: 1000,
        }),
      },
    });

    await service.cleanProfileStorage('p1', { action: 'cleanExtensionCache' });

    assert.equal(getProfileTotalBytes.mock.callCount(), 0);
  });

  it('skips filesystem measurement for deepCleanDatabase', async () => {
    const getProfileTotalBytes = mock.fn(async () => 1000);
    const service = createService({
      storageAnalyzer: {
        getProfileTotalBytes,
        calculateProfileStorageSize: async () => ({
          profileId: 'p1',
          databaseBytes: 1000,
          walBytes: 0,
          workspaceStorageBytes: 0,
          editorCacheBytes: 0,
          extensionCacheBytes: 0,
          efficiencyDbBytes: 0,
          totalBytes: 1000,
        }),
      },
      databaseCleanup: {
        deepClean: async () => ({
          backupPath: '/tmp/state.vscdb.backup-1',
          bytesReclaimed: 2048,
        }),
      },
    });

    const result = await service.cleanProfileStorage('p1', {
      action: 'deepCleanDatabase',
    });

    assert.equal(getProfileTotalBytes.mock.callCount(), 0);
    assert.equal(result.bytesReclaimed, 2048);
  });

  it('computes reclaimed bytes after cleanup when analyzer reports less usage', async () => {
    let callCount = 0;
    const service = createService({
      cacheCleanup: { cleanEditorCache: async () => 500 },
      storageAnalyzer: {
        getProfileTotalBytes: async () => {
          callCount += 1;
          return callCount === 1 ? 1000 : 400;
        },
        calculateProfileStorageSize: async () => ({
          profileId: 'p1',
          databaseBytes: 400,
          walBytes: 0,
          workspaceStorageBytes: 0,
          editorCacheBytes: 0,
          extensionCacheBytes: 0,
          efficiencyDbBytes: 0,
          totalBytes: 400,
        }),
      },
    });

    const result = await service.cleanProfileStorage('p1', {
      action: 'cleanEditorCache',
    });

    assert.equal(result.success, true);
    assert.equal(result.bytesReclaimed, 600);
    assert.match(result.message, /Freed/);
  });
});

describe('VSCodeCacheService', () => {
  it('clears extension globalState cache entries', async () => {
    const { VSCodeCacheService } = await import('../storage/vscodeCacheService');
    const globalStateStore = new Map<string, unknown>([
      [
        'multiProfileQuotaCache',
        [
          { id: 'p1', quota: {} },
          { id: 'p2', quota: {} },
        ],
      ],
      ['multiProfileLeaderboardCache', { p1: {}, p2: {} }],
    ]);

    const context = {
      globalState: {
        get: <T>(key: string) => globalStateStore.get(key) as T | undefined,
        update: async (key: string, value: unknown) => {
          globalStateStore.set(key, value);
        },
      },
    } as unknown as vscode.ExtensionContext;

    const service = new VSCodeCacheService({
      context,
      fileSystem: {
        stat: async () => null,
        getFileSize: async () => 0,
        getPathSize: async () => 0,
        removeDirectory: async () => ({ bytes: 0 }),
        copyFile: async () => undefined,
      },
      efficiencyService: {
        restartPromptDetector: async () => undefined,
      } as unknown as import('../modelEfficiency/efficiencyService').EfficiencyService,
      isCurrentProfile: async () => false,
    });

    await service.cleanExtensionCache('p1');

    const quota = globalStateStore.get('multiProfileQuotaCache') as Array<{
      id: string;
    }>;
    assert.deepEqual(
      quota.map((entry) => entry.id),
      ['p2']
    );
    assert.equal(
      'p1' in (globalStateStore.get('multiProfileLeaderboardCache') as object),
      false
    );
  });
});

describe('SqliteCleanupService', () => {
  it('creates backup before invoking deep clean script', async () => {
    const { SqliteCleanupService } = await import(
      '../storage/sqliteCleanupService'
    );

    let backupCreated = false;
    const fileSystem = {
      getFileSize: async () => 4096,
      copyFile: async (source: string, destination: string) => {
        backupCreated = destination.includes('.backup-');
        assert.match(source, /state\.vscdb$/);
      },
      stat: async () => null,
      getPathSize: async () => 0,
      removeDirectory: async () => ({ bytes: 0 }),
    };

    const service = new SqliteCleanupService({
      extensionPath: process.cwd(),
      fileSystem,
    });

    const dbPath = path.join(
      os.homedir(),
      '.cursor-sqlite-test',
      'User',
      'globalStorage',
      'state.vscdb'
    );

    await assert.rejects(service.deepClean(dbPath));
    assert.equal(backupCreated, true);
  });
});
