import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  InstanceDetector,
  instanceMapToRecord,
} from '../profiles/instanceDetector';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileStorage } from '../profiles/profileStorage';
import type { InstanceInfo } from '../profiles/types';
import { required } from './testUtils';

describe('InstanceDetector', () => {
  let tempDir: string;
  let manager: ProfileManager;
  let detector: InstanceDetector;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-instance-detector-')
    );
    const storage = new ProfileStorage(tempDir);
    manager = new ProfileManager(storage);
    await manager.initialize();
    detector = new InstanceDetector(manager);
  });

  afterEach(async () => {
    detector.stopAutoDetection();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('detectRunningInstances', () => {
    it('returns a map', async () => {
      const instances = await detector.detectRunningInstances();
      assert.ok(instances instanceof Map);
    });

    it('returns empty map when no profiles configured', async () => {
      const instances = await detector.detectRunningInstances();
      assert.equal(instances.size, 0);
    });

    it('matches processes to configured profiles by user data dir', async () => {
      const profile = await manager.createProfile({
        email: 'running@example.com',
        displayName: 'Running',
      });

      const testDetector = new InstanceDetector(manager, async () => [
        { pid: 4242, userDataDir: profile.userDataDir },
      ]);

      const instances = await testDetector.detectRunningInstances();

      assert.equal(instances.size, 1);
      assert.ok(instances.has(profile.id));
      assert.equal(instances.get(profile.id)?.pid, 4242);
    });

    it('tracks multiple instances for the same profile with different projects', async () => {
      const profile = await manager.createProfile({
        email: 'multi@example.com',
        displayName: 'Multi',
      });

      const testDetector = new InstanceDetector(manager, async () => [
        {
          pid: 4242,
          userDataDir: profile.userDataDir,
          projectPath: '/Users/dev/repo-one',
        },
        {
          pid: 4243,
          userDataDir: profile.userDataDir,
          projectPath: '/Users/dev/repo-two',
        },
      ]);

      const instances = await testDetector.detectRunningInstances();

      assert.equal(instances.size, 2);
      assert.ok(instances.has(`${profile.id}:/Users/dev/repo-one`));
      assert.ok(instances.has(`${profile.id}:/Users/dev/repo-two`));
    });

    it('ignores processes without matching profile', async () => {
      await manager.createProfile({
        email: 'other@example.com',
      });

      const testDetector = new InstanceDetector(manager, async () => [
        { pid: 9999, userDataDir: '/tmp/unmatched-profile-dir' },
      ]);

      const instances = await testDetector.detectRunningInstances();
      assert.equal(instances.size, 0);
    });
  });

  describe('getLastDetection', () => {
    it('returns cached detection', async () => {
      await detector.detectRunningInstances();
      const cached = detector.getLastDetection();

      assert.ok(cached instanceof Map);
    });
  });

  describe('startAutoDetection', () => {
    it('starts polling without error', () => {
      detector.startAutoDetection(5000);
      assert.ok(true);
    });

    it('can be stopped', () => {
      detector.startAutoDetection(5000);
      detector.stopAutoDetection();
      assert.ok(true);
    });

    it('notifies listeners when detection changes', async () => {
      const profile = await manager.createProfile({
        email: 'notify@example.com',
      });

      let callbackCount = 0;
      let lastInstances: Map<string, InstanceInfo> | undefined;

      const testDetector = new InstanceDetector(manager, async () => [
        { pid: 9001, userDataDir: profile.userDataDir },
      ]);

      testDetector.onDetectionChange((instances) => {
        callbackCount += 1;
        lastInstances = instances;
      });

      await testDetector.detectRunningInstances();

      assert.equal(callbackCount, 1);
      assert.ok(lastInstances?.has(profile.id));
    });

    it('does not notify listeners when detection is unchanged', async () => {
      const profile = await manager.createProfile({
        email: 'stable@example.com',
      });

      let callbackCount = 0;
      const testDetector = new InstanceDetector(manager, async () => [
        { pid: 9001, userDataDir: profile.userDataDir },
      ]);

      testDetector.onDetectionChange(() => {
        callbackCount += 1;
      });

      await testDetector.detectRunningInstances();
      await testDetector.detectRunningInstances();

      assert.equal(callbackCount, 1);
    });
  });

  describe('isProfileRunning', () => {
    it('returns boolean', async () => {
      const result = await detector.isProfileRunning('non-existent-id');
      assert.equal(typeof result, 'boolean');
    });

    it('returns false for non-existent profile', async () => {
      const result = await detector.isProfileRunning('non-existent-id');
      assert.equal(result, false);
    });

    it('returns true when profile process is detected', async () => {
      const profile = await manager.createProfile({
        email: 'active@example.com',
      });

      const testDetector = new InstanceDetector(manager, async () => [
        { pid: 8080, userDataDir: profile.userDataDir },
      ]);

      assert.equal(await testDetector.isProfileRunning(profile.id), true);
    });
  });

  describe('isProfileProjectRunning', () => {
    it('returns true only for matching profile and project path', async () => {
      const profile = await manager.createProfile({
        email: 'project@example.com',
      });

      const testDetector = new InstanceDetector(manager, async () => [
        {
          pid: 8080,
          userDataDir: profile.userDataDir,
          projectPath: '/Users/dev/repo-one',
        },
      ]);

      assert.equal(
        await testDetector.isProfileProjectRunning(
          profile.id,
          '/Users/dev/repo-one'
        ),
        true
      );
      assert.equal(
        await testDetector.isProfileProjectRunning(
          profile.id,
          '/Users/dev/repo-two'
        ),
        false
      );
    });
  });

  describe('instanceMapToRecord', () => {
    it('converts map to JSON-safe record', () => {
      const map = new Map<string, InstanceInfo>([
        [
          'profile-1',
          {
            profileId: 'profile-1',
            pid: 100,
            userDataDir: '/tmp/profile-1',
            detectedAt: 1234567890,
          },
        ],
      ]);

      const record = instanceMapToRecord(map);
      assert.deepEqual(required(record['profile-1'], 'profile-1').pid, 100);
    });
  });
});
