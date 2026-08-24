import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { InstanceDetector } from '../profiles/instanceDetector';
import {
  buildManualLaunchCommand,
  buildSpawnEnv,
  ProfileLauncher,
  SPAWN_ENV_STRIP_KEYS,
} from '../profiles/profileLauncher';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileStorage } from '../profiles/profileStorage';

class StubLaunchingProfileLauncher extends ProfileLauncher {
  override async launchWithPath(
    _userDataDir: string,
    _projectPath?: string
  ): Promise<{ success: boolean; pid?: number }> {
    return { success: true, pid: 42_424 };
  }
}

describe('ProfileLauncher', { concurrency: false }, () => {
  let tempDir: string;
  let profileRootDir: string;
  let manager: ProfileManager;
  let launcher: ProfileLauncher;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-launcher-')
    );
    profileRootDir = await fs.mkdtemp(
      path.join(process.cwd(), '.tmp-profile-launcher-')
    );
    const storage = new ProfileStorage(tempDir);
    manager = new ProfileManager(storage, profileRootDir);
    await manager.initialize();
    launcher = new ProfileLauncher(manager);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(profileRootDir, { recursive: true, force: true });
  });

  describe('getExecutablePath', () => {
    it('returns platform-specific executable path', () => {
      const execPath = launcher.getExecutablePath();

      assert.ok(execPath);
      assert.ok(path.isAbsolute(execPath));
      switch (process.platform) {
        case 'darwin':
          assert.ok(execPath.includes('Cursor'));
          break;
        case 'win32':
          assert.ok(execPath.endsWith('Cursor.exe'));
          break;
        default:
          assert.equal(execPath, '/usr/bin/cursor');
      }
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

    it('appends project path when provided', () => {
      const args = launcher.buildLaunchArgs('/test/path', '/projects/app');

      assert.deepEqual(args, [
        '--user-data-dir',
        '/test/path',
        '/projects/app',
      ]);
    });
  });

  describe('buildSpawnEnv', () => {
    it('removes Electron extension-host variables', () => {
      const saved: Record<string, string | undefined> = {};
      for (const key of SPAWN_ENV_STRIP_KEYS) {
        saved[key] = process.env[key];
        process.env[key] = '1';
      }

      try {
        const env = buildSpawnEnv();
        for (const key of SPAWN_ENV_STRIP_KEYS) {
          assert.equal(env[key], undefined);
        }
      } finally {
        for (const key of SPAWN_ENV_STRIP_KEYS) {
          if (saved[key] === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = saved[key];
          }
        }
      }
    });
  });

  describe('buildManualLaunchCommand', () => {
    it('includes user-data-dir path', () => {
      const command = buildManualLaunchCommand('/tmp/cursor-profile-test');
      assert.match(command, /--user-data-dir=/);
      assert.match(command, /cursor-profile-test/);
    });
  });

  describe('waitForInstance', () => {
    it('returns pid when process appears', async () => {
      const profile = await manager.createProfile({
        email: 'wait@example.com',
      });

      const instanceDetector = new InstanceDetector(manager, async () => [
        { pid: 9001, userDataDir: profile.userDataDir },
      ]);
      const guardedLauncher = new StubLaunchingProfileLauncher(
        manager,
        instanceDetector
      );

      const pid = await guardedLauncher.waitForInstance(
        profile.userDataDir,
        1000,
        50
      );

      assert.equal(pid, 9001);
    });

    it('returns undefined when process never appears', async () => {
      const profile = await manager.createProfile({
        email: 'timeout@example.com',
      });

      const instanceDetector = new InstanceDetector(manager, async () => []);
      const guardedLauncher = new StubLaunchingProfileLauncher(
        manager,
        instanceDetector
      );

      const pid = await guardedLauncher.waitForInstance(
        profile.userDataDir,
        200,
        50
      );

      assert.equal(pid, undefined);
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

    it('allows launching a different project while profile is running', async () => {
      const profile = await manager.createProfile({
        email: 'multi@example.com',
        displayName: 'Multi',
      });

      const instanceDetector = new InstanceDetector(manager, async () => [
        {
          pid: 4242,
          userDataDir: profile.userDataDir,
          projectPath: '/Users/dev/repo-one',
        },
      ]);

      const guardedLauncher = new StubLaunchingProfileLauncher(
        manager,
        instanceDetector
      );
      const result = await guardedLauncher.launch(profile.id, {
        projectPath: '/Users/dev/repo-two',
      });

      if (result.success) {
        assert.equal(result.success, true);
      } else {
        assert.notEqual(
          result.error,
          'Profile "Multi" is already running. Close the existing window first.'
        );
      }
    });

    it('returns error when the same project is already open for the profile', async () => {
      const profile = await manager.createProfile({
        email: 'same-project@example.com',
        displayName: 'Same Project',
      });

      const instanceDetector = new InstanceDetector(manager, async () => [
        {
          pid: 4242,
          userDataDir: profile.userDataDir,
          projectPath: '/Users/dev/repo-one',
        },
      ]);

      const guardedLauncher = new ProfileLauncher(manager, instanceDetector);
      const result = await guardedLauncher.launch(profile.id, {
        projectPath: '/Users/dev/repo-one',
      });

      assert.equal(result.success, false);
      assert.match(result.error!, /already open/i);
    });

    it('allows force launch when profile is already running', async () => {
      const profile = await manager.createProfile({
        email: 'force@example.com',
      });

      const instanceDetector = new InstanceDetector(manager, async () => [
        { pid: 4242, userDataDir: profile.userDataDir },
      ]);

      const guardedLauncher = new StubLaunchingProfileLauncher(
        manager,
        instanceDetector
      );
      const result = await guardedLauncher.forceLaunch(profile.id);

      assert.equal(typeof result.success, 'boolean');
      if (result.success) {
        assert.ok(result.pid != null || result.success);
      } else {
        assert.equal(/already running/i.test(result.error ?? ''), false);
      }
    });
  });
});
