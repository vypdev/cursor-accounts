import './registerVscodeMock';
import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';
import * as os from 'os';
import * as path from 'path';
import type {
  FileSystemOperationResult,
  IFileSystemService,
} from '../domain/ports/IFileSystemService';
import type { IProfileStorageAnalyzer } from '../domain/ports/IProfileStorageAnalyzer';
import type { IStorageCleanupService } from '../domain/ports/IStorageCleanupService';
import { initL10nForTests } from '../l10n';
import type { EfficiencyService } from '../modelEfficiency/efficiencyService';
import type { InstanceDetector } from '../profiles/instanceDetector';
import type { ProfileDetector } from '../profiles/profileDetector';
import type { ProfileLauncher } from '../profiles/profileLauncher';
import type { ProfileManager } from '../profiles/profileManager';
import type { FromWebviewMessage, ToWebviewMessage } from '../profiles/types';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import { AccountsPanelHandlers } from '../ui/accountsPanelHandlers';

const MESSAGES: Record<string, string> = {
  'errors.profileNotFound': 'Profile not found',
  'panel.launched': 'Launched {name}',
  'panel.profileFallback': 'Profile',
};

function createMockProfile() {
  return {
    id: 'p1',
    slug: 'work',
    email: 'user@example.com',
    displayName: 'Work',
    userDataDir: '/home/user/.cursor-work',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    created: '2024-01-01T00:00:00.000Z',
  };
}

function createHandlers(overrides: {
  profileManager?: Partial<ProfileManager>;
  storageCleanupService?: Partial<IStorageCleanupService>;
  storageAnalyzer?: Partial<IProfileStorageAnalyzer>;
} = {}) {
  const postedMessages: ToWebviewMessage[] = [];

  const handlers = new AccountsPanelHandlers(
    {
      profileManager: {
        getProfile: async () => createMockProfile(),
        ...overrides.profileManager,
      } as unknown as ProfileManager,
      profileLauncher: {} as ProfileLauncher,
      profileDetector: {} as ProfileDetector,
      efficiencyService: {} as EfficiencyService,
      authReader: {} as IProfileAuthReader,
      instanceDetector: {} as InstanceDetector,
      storageCleanupService: {
        cleanProfileStorage: async () => ({
          success: true,
          bytesReclaimed: 1024,
          message: 'Freed 1.0 KB',
        }),
        ...overrides.storageCleanupService,
      },
      storageAnalyzer: {
        calculateProfileStorageSize: async () => ({
          profileId: 'p1',
          databaseBytes: 1024,
          walBytes: 0,
          workspaceStorageBytes: 0,
          editorCacheBytes: 0,
          extensionCacheBytes: 0,
          totalBytes: 1024,
        }),
        getProfileTotalBytes: async () => 1024,
        ...overrides.storageAnalyzer,
      },
      profileWorkspaceService: {
        getMostRecentWorkspace: async () => undefined,
        getWorkspacesForProfile: async () => [],
        getProfilesWithWorkspaces: async () => [],
      } as unknown as import('../services/profileWorkspaceService').ProfileWorkspaceService,
    },
    {
      postMessage: async (message) => {
        postedMessages.push(message);
      },
      refresh: async () => undefined,
      refreshInstances: async () => undefined,
      hasActiveWebview: () => true,
    }
  );

  return { handlers, postedMessages };
}

describe('AccountsPanelHandlers storage', () => {
  beforeEach(() => {
    initL10nForTests(MESSAGES);
  });

  it('posts storage breakdown when profile exists', async () => {
    const { handlers, postedMessages } = createHandlers();

    await handlers.handle({
      type: 'requestStorageInfo',
      profileId: 'p1',
    } satisfies FromWebviewMessage);

    const storageMessage = postedMessages.find((m) => m.type === 'storageInfo');
    assert.ok(storageMessage);
    assert.equal(storageMessage.type, 'storageInfo');
    if (storageMessage.type === 'storageInfo') {
      assert.equal(storageMessage.data.profileId, 'p1');
      assert.equal(storageMessage.data.totalBytes, 1024);
    }
  });

  it('posts storage error when requesting storage for missing profile', async () => {
    const { handlers, postedMessages } = createHandlers({
      profileManager: {
        getProfile: async () => undefined,
      },
    });

    await handlers.handle({
      type: 'requestStorageInfo',
      profileId: 'missing',
    } satisfies FromWebviewMessage);

    const storageMessage = postedMessages.find((m) => m.type === 'storageInfo');
    assert.ok(storageMessage);
    if (storageMessage?.type === 'storageInfo') {
      assert.equal(storageMessage.data.profileId, 'missing');
      assert.equal(storageMessage.data.error, 'Profile not found');
      assert.equal(storageMessage.data.totalBytes, 0);
    }
  });

  it('posts cleanup result and refreshed storage on success', async () => {
    const cleanProfileStorage = mock.fn(async () => ({
      success: true,
      bytesReclaimed: 512,
      message: 'Freed 512 B',
    }));

    const { handlers, postedMessages } = createHandlers({
      storageCleanupService: { cleanProfileStorage },
    });

    await handlers.handle({
      type: 'cleanStorage',
      profileId: 'p1',
      options: { action: 'cleanExtensionCache' },
    } satisfies FromWebviewMessage);

    assert.equal(cleanProfileStorage.mock.callCount(), 1);
    assert.ok(postedMessages.some((m) => m.type === 'storageCleanupResult'));
    assert.ok(postedMessages.some((m) => m.type === 'storageInfo'));
    assert.equal(postedMessages.some((m) => m.type === 'success'), false);
  });

  it('posts error message when cleanup fails', async () => {
    const { handlers, postedMessages } = createHandlers({
      storageCleanupService: {
        cleanProfileStorage: async () => ({
          success: false,
          bytesReclaimed: 0,
          message: 'Profile is running',
          error: 'Profile is running',
        }),
      },
    });

    await handlers.handle({
      type: 'cleanStorage',
      profileId: 'p1',
      options: { action: 'vacuumDatabase' },
    } satisfies FromWebviewMessage);

    assert.ok(
      postedMessages.some(
        (m) => m.type === 'storageCleanupResult' && !m.data.success
      )
    );
    assert.equal(postedMessages.some((m) => m.type === 'error'), false);
  });
});

describe('NodeFileSystemService error handling', () => {
  it('distinguishes ENOENT from permission errors in removeDirectory', async () => {
    const { NodeFileSystemService } = await import(
      '../storage/nodeFileSystemService'
    );
    const service = new NodeFileSystemService();

    const missing = await service.removeDirectory('/nonexistent/path/for-test');
    assert.equal(missing.bytes, 0);
    assert.equal(missing.notFound, true);
  });
});

describe('ProfileStorageAnalyzer', () => {
  it('uses injected filesystem port', async () => {
    const { ProfileStorageAnalyzer } = await import(
      '../storage/profileStorageAnalyzer'
    );

    const mockFs: IFileSystemService = {
      stat: async () => null,
      getFileSize: async (p) => (p.endsWith('state.vscdb') ? 2048 : 0),
      getPathSize: async () => 0,
      removeDirectory: async (): Promise<FileSystemOperationResult> => ({
        bytes: 0,
      }),
      copyFile: async () => undefined,
    };

    const analyzer = new ProfileStorageAnalyzer(mockFs);
    const breakdown = await analyzer.calculateProfileStorageSize(
      'p1',
      path.join(os.homedir(), '.cursor-test-profile-analyzer')
    );

    assert.equal(breakdown.databaseBytes, 2048);
  });
});
