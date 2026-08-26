import './registerVscodeMock';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { beforeEach, describe, it, mock } from 'node:test';
import * as fs from 'node:fs/promises';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import type { ICacheCleanupService } from '../domain/ports/ICacheCleanupService';
import type { IDatabaseCleanupService } from '../domain/ports/IDatabaseCleanupService';
import type { IEfficiencyEventsCleanupService } from '../domain/ports/IEfficiencyEventsCleanupService';
import type { IInstanceDetector } from '../domain/ports/IInstanceDetector';
import type { IProfileStorageAnalyzer } from '../domain/ports/IProfileStorageAnalyzer';
import { initL10nForTests } from '../l10n';
import type { ProfileDetector } from '../profiles/profileDetector';
import type { ProfileManager } from '../profiles/profileManager';
import { StorageCleanupService } from '../services/storageCleanupService';
import { getSqlite3Binary } from '../auth/sqliteBinary';
import { NodeFileSystemService } from '../storage/nodeFileSystemService';

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
  'storageCleanup.efficiencyEventsCleaned':
    'Cleaned {count} events older than {days} days ({amount})',
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
  instanceDetector?: Partial<IInstanceDetector>;
  storageAnalyzer?: Partial<IProfileStorageAnalyzer>;
  cacheCleanup?: Partial<ICacheCleanupService>;
  databaseCleanup?: Partial<IDatabaseCleanupService>;
  efficiencyEventsCleanup?: Partial<IEfficiencyEventsCleanupService>;
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
    } as IInstanceDetector,
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
      restoreDeepCleanBackup: async () => undefined,
      ...overrides.databaseCleanup,
    },
    efficiencyEventsCleanup: {
      cleanOldEvents: async () => ({ removedEvents: 0, bytesReclaimed: 0 }),
      ...overrides.efficiencyEventsCleanup,
    },
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

  it('reports bytes reclaimed when editor cleanup fails after partial deletion', async () => {
    const { PartialCleanupError } = await import(
      '../domain/types/storageCleanup'
    );
    const service = createService({
      cacheCleanup: {
        cleanEditorCache: async () => {
          throw new PartialCleanupError('Editor cache cleanup was partial', 128);
        },
      },
    });

    const result = await service.cleanProfileStorage('p1', {
      action: 'cleanEditorCache',
    });

    assert.equal(result.success, false);
    assert.equal(result.bytesReclaimed, 128);
    assert.match(result.message, /partial/i);
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

  it('cleans expired efficiency events through the injected port', async () => {
    let received: {
      profileId: string;
      userDataDir: string;
      beforeTimestamp: number;
    } | undefined;
    const cleanOldEvents = mock.fn(
      async (profileId: string, userDataDir: string, beforeTimestamp: number) => {
        received = { profileId, userDataDir, beforeTimestamp };
        return { removedEvents: 4, bytesReclaimed: 128 };
      }
    );
    const service = createService({
      efficiencyEventsCleanup: { cleanOldEvents },
    });

    const result = await service.cleanProfileStorage('p1', {
      action: 'cleanEfficiencyEvents',
    });

    assert.equal(result.success, true);
    assert.equal(result.bytesReclaimed, 128);
    assert.match(result.message, /4 events older than 90 days/);
    assert.equal(cleanOldEvents.mock.callCount(), 1);
    assert.ok(received);
    assert.equal(received.profileId, 'p1');
    assert.match(received.userDataDir, /cursor-test-profile-full/);
    const nowSeconds = Math.floor(Date.now() / 1000);
    assert.ok(received.beforeTimestamp <= nowSeconds - 90 * 24 * 60 * 60);
    assert.ok(received.beforeTimestamp >= nowSeconds - 90 * 24 * 60 * 60 - 1);
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

  it('preserves partial deletion information when a later cache directory fails', async () => {
    const { VSCodeCacheService } = await import('../storage/vscodeCacheService');
    let calls = 0;
    const service = new VSCodeCacheService({
      context: {} as vscode.ExtensionContext,
      fileSystem: {
        stat: async () => null,
        getFileSize: async () => 0,
        getPathSize: async () => 0,
        removeDirectory: async () => {
          calls += 1;
          if (calls === 1) {
            return { bytes: 256 };
          }
          throw Object.assign(new Error('No space left on device'), {
            code: 'ENOSPC',
          });
        },
        copyFile: async () => undefined,
      },
      efficiencyService: {} as unknown as import('../modelEfficiency/efficiencyService').EfficiencyService,
      isCurrentProfile: async () => false,
    });

    await assert.rejects(
      service.cleanEditorCache('/tmp/profile'),
      (error: unknown) => {
        return (
          error instanceof Error &&
          error.name === 'PartialCleanupError' &&
          'bytesReclaimed' in error &&
          error.bytesReclaimed === 256 &&
          error.message.includes('No space left on device')
        );
      }
    );
  });
});

describe('SqliteCleanupService', () => {
  it('creates a consistent backup before invoking deep clean script', async () => {
    const { SqliteCleanupService } = await import(
      '../storage/sqliteCleanupService'
    );

    const tempDir = await fs.mkdtemp(
      path.join(process.cwd(), '.sqlite-cleanup-test-')
    );
    const dbPath = path.join(tempDir, 'state.vscdb');

    try {
      const sqliteBinary = getSqlite3Binary(process.cwd());
      execFileSync(sqliteBinary, [
        dbPath,
        `CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT);
         INSERT INTO cursorDiskKV (key, value) VALUES ('composerData:1', 'secret');
         INSERT INTO cursorDiskKV (key, value) VALUES ('keep:1', 'retain');`,
      ]);

      const service = new SqliteCleanupService({
        extensionPath: process.cwd(),
        fileSystem: new NodeFileSystemService(),
      });

      const result = await service.deepClean(dbPath);
      const backupRows = execFileSync(sqliteBinary, [
        '-json',
        result.backupPath,
        'SELECT key, value FROM cursorDiskKV ORDER BY key;',
      ], { encoding: 'utf8' });
      const cleanedRows = execFileSync(sqliteBinary, [
        '-json',
        dbPath,
        'SELECT key, value FROM cursorDiskKV ORDER BY key;',
      ], { encoding: 'utf8' });

      assert.deepEqual(JSON.parse(backupRows), [
        { key: 'composerData:1', value: 'secret' },
        { key: 'keep:1', value: 'retain' },
      ]);
      assert.deepEqual(JSON.parse(cleanedRows), [
        { key: 'keep:1', value: 'retain' },
      ]);

      await service.restoreDeepCleanBackup(dbPath, result.backupPath);
      const restoredRows = execFileSync(sqliteBinary, [
        '-json',
        dbPath,
        'SELECT key, value FROM cursorDiskKV ORDER BY key;',
      ], { encoding: 'utf8' });
      assert.deepEqual(JSON.parse(restoredRows), [
        { key: 'composerData:1', value: 'secret' },
        { key: 'keep:1', value: 'retain' },
      ]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects an invalid backup before changing the database', async () => {
    const { SqliteCleanupService } = await import(
      '../storage/sqliteCleanupService'
    );
    const tempDir = await fs.mkdtemp(
      path.join(process.cwd(), '.sqlite-restore-test-')
    );
    const dbPath = path.join(tempDir, 'state.vscdb');
    const backupPath = `${dbPath}.backup-123`;

    try {
      const sqliteBinary = getSqlite3Binary(process.cwd());
      execFileSync(sqliteBinary, [
        dbPath,
        `CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT);
         INSERT INTO cursorDiskKV (key, value) VALUES ('keep:1', 'retain');`,
      ]);
      await fs.writeFile(backupPath, 'not a sqlite database');

      const service = new SqliteCleanupService({
        extensionPath: process.cwd(),
        fileSystem: new NodeFileSystemService(),
      });

      await assert.rejects(
        service.restoreDeepCleanBackup(dbPath, backupPath),
        /integrity|database|SQLite/i
      );
      const rows = execFileSync(sqliteBinary, [
        '-json',
        dbPath,
        'SELECT key, value FROM cursorDiskKV;',
      ], { encoding: 'utf8' });
      assert.deepEqual(JSON.parse(rows), [
        { key: 'keep:1', value: 'retain' },
      ]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
