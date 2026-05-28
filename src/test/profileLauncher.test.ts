import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { InstanceDetector } from '../profiles/instanceDetector';
import { ProfileLauncher } from '../profiles/profileLauncher';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileStorage } from '../profiles/profileStorage';

describe('ProfileLauncher', () => {
  let tempDir: string;
  let manager: ProfileManager;
  let launcher: ProfileLauncher;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-quota-launcher-')
    );
    const storage = new ProfileStorage(tempDir);
    manager = new ProfileManager(storage);
    await manager.initialize();
    launcher = new ProfileLauncher(manager);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('getExecutablePath', () => {
    it('returns platform-specific executable path', () => {
      const execPath = launcher.getExecutablePath();

      assert.ok(execPath);
      assert.ok(path.isAbsolute(execPath));
      assert.ok(execPath.includes('Cursor'));
    });

    it('returns correct path for macOS', () => {
      if (process.platform === 'darwin') {
        const execPath = launcher.getExecutablePath();
        assert.equal(
          execPath,
          '/Applications/Cursor.app/Contents/MacOS/Cursor'
        );
      }
    });
  });

  describe('buildLaunchArgs', () => {
    it('includes user-data-dir flag', () => {
      const args = launcher.buildLaunchArgs('/test/path');

      assert.ok(args.includes('--user-data-dir'));
      assert.ok(args.includes('/test/path'));
    });
  });

  describe('buildLaunchCommand', () => {
    it('builds complete command array', async () => {
      const profile = await manager.createProfile({
        email: 'test@example.com',
      });

      const command = launcher.buildLaunchCommand(profile);

      assert.ok(Array.isArray(command));
      assert.ok(command.length > 0);
      assert.ok(command.some((arg) => arg.includes('--user-data-dir')));
      assert.ok(command.some((arg) => arg.includes(profile.userDataDir)));
    });
  });

  describe('validateExecutable', () => {
    it('returns validation result', async () => {
      const result = await launcher.validateExecutable();

      assert.equal(typeof result.valid, 'boolean');
      if (!result.valid) {
        assert.ok(result.error);
      }
    });
  });

  describe('launch', () => {
    it('returns error for non-existent profile', async () => {
      const result = await launcher.launch('non-existent-id');

      assert.equal(result.success, false);
      assert.ok(result.error);
      assert.match(result.error!, /not found/);
    });

    it('returns error when profile is already running', async () => {
      const profile = await manager.createProfile({
        email: 'running@example.com',
        displayName: 'Running',
      });

      const instanceDetector = new InstanceDetector(manager, async () => [
        { pid: 4242, userDataDir: profile.userDataDir },
      ]);

      const guardedLauncher = new ProfileLauncher(manager, instanceDetector);
      const result = await guardedLauncher.launch(profile.id);

      assert.equal(result.success, false);
      assert.match(result.error!, /already running/i);
    });

    it('allows force launch when profile is already running', async () => {
      const profile = await manager.createProfile({
        email: 'force@example.com',
      });

      const instanceDetector = new InstanceDetector(manager, async () => [
        { pid: 4242, userDataDir: profile.userDataDir },
      ]);

      const guardedLauncher = new ProfileLauncher(manager, instanceDetector);
      const result = await guardedLauncher.forceLaunch(profile.id);

      assert.notEqual(result.success, undefined);
    });
  });
});
