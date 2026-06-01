import './registerVscodeMock';
import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';
import * as os from 'os';
import * as path from 'path';
import { initL10nForTests } from '../l10n';
import type { InstanceDetector } from '../profiles/instanceDetector';
import type { ProfileDetector } from '../profiles/profileDetector';
import type { ProfileManager } from '../profiles/profileManager';
import type { ICacheCleanupService } from '../domain/ports/ICacheCleanupService';
import type { IDatabaseCleanupService } from '../domain/ports/IDatabaseCleanupService';
import type { IProfileStorageAnalyzer } from '../domain/ports/IProfileStorageAnalyzer';
import { StorageCleanupService } from '../services/storageCleanupService';

const MESSAGES: Record<string, string> = {
  'errors.profileNotFound': 'Profile not found',
  'storageCleanup.profileNotFound': 'Profile not found',
  'storageCleanup.extensionCacheCleared': 'Extension cache cleared',
  'storageCleanup.deleteOldChatsCurrentWindowOnly':
    'Delete old chats is only available for the profile open in this window.',
  'storageCleanup.freedSpace': 'Freed {amount}',
};

function createService(overrides: {
  profileManager?: Partial<ProfileManager>;
  profileDetector?: Partial<ProfileDetector>;
  instanceDetector?: Partial<InstanceDetector>;
  storageAnalyzer?: Partial<IProfileStorageAnalyzer>;
  cacheCleanup?: Partial<ICacheCleanupService>;
  databaseCleanup?: Partial<IDatabaseCleanupService>;
} = {}): StorageCleanupService {
  const userDataDir = path.join(os.homedir(), '.cursor-test-profile');

  return new StorageCleanupService({
    profileManager: {
      getProfile: async () => ({
        id: 'p1',
        slug: 'work',
        email: 'user@example.com',
        displayName: 'Work',
        userDataDir,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        created: '2024-01-01T00:00:00.000Z',
      }),
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
      getProfileTotalBytes: async () => 0,
      calculateProfileStorageSize: async () => ({
        profileId: 'p1',
        databaseBytes: 0,
        walBytes: 0,
        workspaceStorageBytes: 0,
        editorCacheBytes: 0,
        extensionCacheBytes: 0,
        totalBytes: 0,
      }),
      ...overrides.storageAnalyzer,
    },
    cacheCleanup: {
      cleanExtensionCache: async () => undefined,
      cleanEditorCache: async () => 0,
      deleteOldChats: async () => false,
      gcAgentKvBlobs: async () => false,
      ...overrides.cacheCleanup,
    },
    databaseCleanup: {
      vacuum: async () => undefined,
      deepClean: async () => ({ backupPath: '/tmp/b', bytesReclaimed: 0 }),
      ...overrides.databaseCleanup,
    },
  });
}

describe('StorageCleanupService', () => {
  beforeEach(() => {
    initL10nForTests(MESSAGES);
  });

  it('clears extension cache entries for a profile', async () => {
    const profileUserDataDir = path.join(os.homedir(), '.cursor-test-profile');
    const cleanExtensionCache = mock.fn(async () => undefined);

    const service = createService({
      profileDetector: {
        detectCurrentProfile: async () => ({
          id: 'p1',
          slug: 'work',
          email: 'user@example.com',
          displayName: 'Work',
          userDataDir: profileUserDataDir,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          created: '2024-01-01T00:00:00.000Z',
        }),
      },
      cacheCleanup: { cleanExtensionCache },
    });

    const result = await service.cleanProfileStorage('p1', {
      action: 'cleanExtensionCache',
    });

    assert.equal(result.success, true);
    assert.match(result.message, /Extension cache cleared/);
    assert.equal(cleanExtensionCache.mock.callCount(), 1);
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
});
