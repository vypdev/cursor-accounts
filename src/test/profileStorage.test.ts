import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  ProfileStorage,
  ProfileStorageError,
} from '../profiles/profileStorage';
import { PROFILE_CONFIG_VERSION } from '../profiles/types';

describe('ProfileStorage', () => {
  let tempDir: string;
  let storage: ProfileStorage;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-quota-test-')
    );
    storage = new ProfileStorage(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates default config on first load', async () => {
    const config = await storage.load();

    assert.equal(config.version, PROFILE_CONFIG_VERSION);
    assert.deepEqual(config.profiles, []);
    assert.equal(typeof config.settings, 'object');
  });

  it('persists and loads config', async () => {
    const config = await storage.load();
    config.profiles.push({
      id: 'test-id',
      email: 'test@example.com',
      slug: 'test_example_com',
      displayName: 'Test',
      userDataDir: '/test/path',
      created: new Date().toISOString(),
    });

    await storage.save(config);

    const storage2 = new ProfileStorage(tempDir);
    const loaded = await storage2.load();

    assert.equal(loaded.profiles.length, 1);
    assert.equal(loaded.profiles[0].email, 'test@example.com');
  });

  it('handles atomic writes', async () => {
    const config = await storage.load();

    const promise1 = storage.save(config);
    const promise2 = storage.save(config);

    await Promise.all([promise1, promise2]);

    const loaded = await storage.load();
    assert.ok(loaded);
  });

  it('creates backup', async () => {
    const config = await storage.load();
    await storage.save(config);

    const backupPath = await storage.backup();

    assert.ok(backupPath.includes('.backup.'));
    const backupExists = await fs
      .access(backupPath)
      .then(() => true)
      .catch(() => false);
    assert.ok(backupExists);
  });

  it('restores from backup', async () => {
    const config = await storage.load();
    config.profiles.push({
      id: 'original',
      email: 'original@example.com',
      slug: 'original_example_com',
      displayName: 'Original',
      userDataDir: '/original',
      created: new Date().toISOString(),
    });
    await storage.save(config);

    const backupPath = await storage.backup();

    config.profiles[0].email = 'modified@example.com';
    await storage.save(config);

    await storage.restore(backupPath);
    const restored = await storage.load();

    assert.equal(restored.profiles[0].email, 'original@example.com');
  });

  it('throws on invalid JSON', async () => {
    const configPath = storage.getConfigPath();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, 'invalid json{', 'utf-8');

    await assert.rejects(() => storage.load(), ProfileStorageError);
  });

  it('validates and repairs manual config edits', async () => {
    const configPath = storage.getConfigPath();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        version: PROFILE_CONFIG_VERSION,
        profiles: [],
        settings: {
          refreshAllInterval: 99999,
          autoDetectRunning: 'not-a-boolean',
        },
      }),
      'utf-8'
    );

    const loaded = await storage.load();
    assert.equal(loaded.settings.refreshAllInterval, 3600);
    assert.equal(loaded.settings.autoDetectRunning, true);
  });
});
