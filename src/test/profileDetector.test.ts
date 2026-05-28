import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ProfileDetector } from '../profiles/profileDetector';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileStorage } from '../profiles/profileStorage';

interface MockExtensionContext {
  globalStorageUri: {
    fsPath: string;
  };
}

function createMockContext(userDataDir: string): MockExtensionContext {
  return {
    globalStorageUri: {
      fsPath: path.join(
        userDataDir,
        'User',
        'globalStorage',
        'vypdev.cursor-quota'
      ),
    },
  };
}

describe('ProfileDetector', () => {
  let tempDir: string;
  let manager: ProfileManager;
  let detector: ProfileDetector;
  let mockUserDataDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-quota-detector-')
    );
    const storage = new ProfileStorage(tempDir);
    manager = new ProfileManager(storage);
    await manager.initialize();

    mockUserDataDir = path.join(tempDir, 'mock-user-data');
    detector = new ProfileDetector(
      manager,
      createMockContext(mockUserDataDir) as never
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('getDefaultCursorUserDataDir', () => {
    it('returns platform-specific default path', () => {
      const defaultDir = detector.getDefaultCursorUserDataDir();

      assert.ok(defaultDir);
      assert.ok(path.isAbsolute(defaultDir));
      assert.ok(defaultDir.includes('Cursor'));
    });
  });

  describe('getCurrentUserDataDir', () => {
    it('returns a valid absolute path', () => {
      const userDataDir = detector.getCurrentUserDataDir();

      assert.ok(userDataDir);
      assert.ok(path.isAbsolute(userDataDir));
    });

    it('derives user data dir from globalStorageUri', () => {
      const userDataDir = detector.getCurrentUserDataDir();
      assert.equal(
        path.normalize(userDataDir),
        path.normalize(mockUserDataDir)
      );
    });
  });

  describe('isDefaultProfile', () => {
    it('returns boolean', () => {
      const isDefault = detector.isDefaultProfile();
      assert.equal(typeof isDefault, 'boolean');
    });

    it('returns false when using custom user data dir', () => {
      assert.equal(detector.isDefaultProfile(), false);
    });
  });

  describe('detectCurrentProfile', () => {
    it('caches result after first call', async () => {
      const profile1 = await detector.detectCurrentProfile();
      const profile2 = await detector.detectCurrentProfile();

      assert.deepEqual(profile1, profile2);
    });

    it('can clear cache and re-detect', async () => {
      await detector.detectCurrentProfile();
      detector.clearCache();

      const profile = await detector.detectCurrentProfile();
      assert.equal(profile, null);
    });

    it('detects profile when user data dir matches configured profile', async () => {
      const created = await manager.createProfile({
        email: 'test@example.com',
        displayName: 'Test',
      });

      const matchingDetector = new ProfileDetector(
        manager,
        createMockContext(created.userDataDir) as never
      );

      const detected = await matchingDetector.detectCurrentProfile();

      assert.ok(detected);
      assert.equal(detected!.id, created.id);
    });

    it('returns null for default profile', async () => {
      const defaultDetector = new ProfileDetector(
        manager,
        createMockContext(detector.getDefaultCursorUserDataDir()) as never
      );

      const profile = await defaultDetector.detectCurrentProfile();
      assert.equal(profile, null);
    });
  });

  describe('getProfileDescription', () => {
    it('returns description string', async () => {
      const description = await detector.getProfileDescription();

      assert.ok(description);
      assert.equal(typeof description, 'string');
    });

    it('returns Default Profile when no custom profile active', async () => {
      const description = await detector.getProfileDescription();
      assert.equal(description, 'Default Profile');
    });

    it('returns profile display name when profile is detected', async () => {
      const created = await manager.createProfile({
        email: 'named@example.com',
        displayName: 'Work Account',
      });

      const matchingDetector = new ProfileDetector(
        manager,
        createMockContext(created.userDataDir) as never
      );

      const description = await matchingDetector.getProfileDescription();
      assert.equal(description, 'Work Account');
    });
  });

  describe('cross-platform path matching', () => {
    it('handles Windows case-insensitivity correctly', async () => {
      if (process.platform !== 'win32') {
        return;
      }

      const profile = await manager.createProfile({
        email: 'test@example.com',
        displayName: 'Test',
      });

      const uppercasePath = profile.userDataDir.toUpperCase();
      const detected = await manager.findProfileByPath(uppercasePath);

      assert.ok(detected);
      assert.equal(detected!.id, profile.id);
    });
  });
});
