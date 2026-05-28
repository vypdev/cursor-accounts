import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  InstanceDetector,
} from '../profiles/instanceDetector';
import {
  ProfileManager,
  ProfileManagerError,
} from '../profiles/profileManager';
import { ProfileStorage } from '../profiles/profileStorage';

describe('ProfileManager', () => {
  let tempDir: string;
  let manager: ProfileManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-test-')
    );
    const storage = new ProfileStorage(tempDir);
    manager = new ProfileManager(storage);
    await manager.initialize();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('createProfile', () => {
    it('creates a profile with valid email', async () => {
      const profile = await manager.createProfile({
        email: 'test@example.com',
      });

      assert.ok(profile.id);
      assert.equal(profile.email, 'test@example.com');
      assert.equal(profile.slug, 'test_example_com');
      assert.ok(profile.userDataDir.includes('.cursor-test_example_com'));
      assert.ok(profile.created);
    });

    it('generates display name from email', async () => {
      const profile = await manager.createProfile({
        email: 'john.doe@example.com',
      });

      assert.equal(profile.displayName, 'John Doe');
    });

    it('uses provided display name', async () => {
      const profile = await manager.createProfile({
        email: 'test@example.com',
        displayName: 'Custom Name',
      });

      assert.equal(profile.displayName, 'Custom Name');
    });

    it('assigns random color', async () => {
      const profile = await manager.createProfile({
        email: 'test@example.com',
      });

      assert.ok(profile.color);
      assert.match(profile.color, /^#[0-9a-f]{6}$/);
    });

    it('rejects duplicate email', async () => {
      await manager.createProfile({ email: 'test@example.com' });

      await assert.rejects(
        () => manager.createProfile({ email: 'test@example.com' }),
        ProfileManagerError
      );
    });

    it('rejects invalid email', async () => {
      await assert.rejects(
        () => manager.createProfile({ email: 'invalid' }),
        ProfileManagerError
      );
    });

    it('handles slug collision by appending hash', async () => {
      const profile1 = await manager.createProfile({
        email: 'test@example.com',
      });
      assert.equal(profile1.slug, 'test_example_com');
      assert.ok(profile1.userDataDir.includes('.cursor-test_example_com'));
      assert.ok(!profile1.slug.match(/_[a-f0-9]{8}$/));

      const storage = new ProfileStorage(tempDir);
      const config = await storage.load();

      config.profiles.push({
        id: 'fake-collision-id',
        email: 'collision@test.com',
        slug: 'test_example_com',
        displayName: 'Collision Test',
        userDataDir: profile1.userDataDir,
        created: new Date().toISOString(),
      });
      await storage.save(config);

      const manager2 = new ProfileManager(storage);
      await manager2.initialize();

      const profile3 = await manager2.createProfile({
        email: 'another@test.com',
      });

      assert.ok(profile3.id);
      assert.ok(profile3.userDataDir);
      assert.notEqual(profile3.userDataDir, profile1.userDataDir);
    });
  });

  describe('getProfiles', () => {
    it('returns empty array initially', async () => {
      const profiles = await manager.getProfiles();
      assert.deepEqual(profiles, []);
    });

    it('returns all profiles', async () => {
      await manager.createProfile({ email: 'user1@example.com' });
      await manager.createProfile({ email: 'user2@example.com' });

      const profiles = await manager.getProfiles();
      assert.equal(profiles.length, 2);
    });
  });

  describe('getProfile', () => {
    it('returns profile by ID', async () => {
      const created = await manager.createProfile({
        email: 'test@example.com',
      });
      const found = await manager.getProfile(created.id);

      assert.deepEqual(found, created);
    });

    it('returns undefined for non-existent ID', async () => {
      const found = await manager.getProfile('non-existent-id');
      assert.equal(found, undefined);
    });
  });

  describe('findProfileByEmail', () => {
    it('finds profile by exact email', async () => {
      await manager.createProfile({ email: 'test@example.com' });
      const found = await manager.findProfileByEmail('test@example.com');

      assert.ok(found);
      assert.equal(found.email, 'test@example.com');
    });

    it('finds profile case-insensitively', async () => {
      await manager.createProfile({ email: 'test@example.com' });
      const found = await manager.findProfileByEmail('TEST@EXAMPLE.COM');

      assert.ok(found);
    });

    it('returns undefined if not found', async () => {
      const found = await manager.findProfileByEmail('nonexistent@example.com');
      assert.equal(found, undefined);
    });
  });

  describe('updateProfile', () => {
    it('updates display name', async () => {
      const created = await manager.createProfile({
        email: 'test@example.com',
      });
      const updated = await manager.updateProfile(created.id, {
        displayName: 'New Name',
      });

      assert.equal(updated.displayName, 'New Name');
      assert.equal(updated.email, created.email);
    });

    it('updates theme and color', async () => {
      const created = await manager.createProfile({
        email: 'test@example.com',
      });
      const updated = await manager.updateProfile(created.id, {
        theme: 'Dark+',
        color: '#ff0000',
      });

      assert.equal(updated.theme, 'Dark+');
      assert.equal(updated.color, '#ff0000');
    });

    it('prevents ID change', async () => {
      const created = await manager.createProfile({
        email: 'test@example.com',
      });
      const updated = await manager.updateProfile(created.id, {
        id: 'new-id',
      } as Partial<typeof created>);

      assert.equal(updated.id, created.id);
    });

    it('throws on non-existent profile', async () => {
      await assert.rejects(
        () => manager.updateProfile('non-existent', { displayName: 'Test' }),
        ProfileManagerError
      );
    });
  });

  describe('deleteProfile', () => {
    it('deletes profile by ID', async () => {
      const created = await manager.createProfile({
        email: 'test@example.com',
      });
      await manager.deleteProfile(created.id);

      const found = await manager.getProfile(created.id);
      assert.equal(found, undefined);
    });

    it('throws on non-existent profile', async () => {
      await assert.rejects(
        () => manager.deleteProfile('non-existent'),
        ProfileManagerError
      );
    });

    it('throws when deleting a running profile', async () => {
      const profile = await manager.createProfile({
        email: 'running-delete@example.com',
        displayName: 'Running Delete',
      });

      const instanceDetector = new InstanceDetector(manager, async () => [
        { pid: 5150, userDataDir: profile.userDataDir },
      ]);

      await assert.rejects(
        () => manager.deleteProfile(profile.id, instanceDetector),
        (error: unknown) => {
          assert.ok(error instanceof ProfileManagerError);
          assert.match(
            (error as ProfileManagerError).message,
            /Cannot delete running profile/
          );
          return true;
        }
      );
    });
  });

  describe('validateEmail', () => {
    it('accepts valid emails', () => {
      assert.equal(manager.validateEmail('user@example.com').valid, true);
      assert.equal(
        manager.validateEmail('user+tag@domain.co.uk').valid,
        true
      );
    });

    it('rejects invalid emails', () => {
      assert.equal(manager.validateEmail('').valid, false);
      assert.equal(manager.validateEmail('invalid').valid, false);
      assert.equal(manager.validateEmail('@example.com').valid, false);
      assert.equal(manager.validateEmail('user@').valid, false);
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', async () => {
      await manager.createProfile({
        email: 'user1@example.com',
        theme: 'Dark+',
      });
      await manager.createProfile({ email: 'user2@example.com' });

      const stats = await manager.getStats();

      assert.equal(stats.totalProfiles, 2);
      assert.equal(stats.profilesWithTheme, 1);
      assert.ok(stats.averageAge >= 0);
    });
  });

  describe('isProfilePathValid', () => {
    it('accepts valid unused path within home', async () => {
      const validPath = path.join(os.homedir(), '.cursor-new-profile-test');
      assert.equal(await manager.isProfilePathValid(validPath), true);
    });

    it('rejects path already used by a profile', async () => {
      const profile = await manager.createProfile({
        email: 'test@example.com',
      });
      assert.equal(await manager.isProfilePathValid(profile.userDataDir), false);
    });
  });
});
