import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  calculateProfileStorageSize,
  formatBytes,
  getDirectorySize,
} from '../utils/storageSize';

describe('storageSize', () => {
  let tempRoot = '';

  before(async () => {
    tempRoot = await fs.mkdtemp(
      path.join(os.homedir(), '.cursor-accounts-storage-test-')
    );
  });

  after(async () => {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  describe('formatBytes', () => {
    it('formats zero and small values', () => {
      assert.equal(formatBytes(0), '0 B');
      assert.equal(formatBytes(512), '512 B');
      assert.equal(formatBytes(1536), '1.5 KB');
    });

    it('formats megabytes and gigabytes', () => {
      assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
      assert.equal(formatBytes(2.5 * 1024 * 1024 * 1024), '2.5 GB');
    });
  });

  describe('calculateProfileStorageSize', () => {
    it('sums database, workspace, and cache directories', async () => {
      const userDataDir = path.join(tempRoot, 'profile-a');
      const stateDbPath = path.join(
        userDataDir,
        'User',
        'globalStorage',
        'state.vscdb'
      );
      const workspaceDir = path.join(userDataDir, 'User', 'workspaceStorage', 'ws1');
      const cacheDir = path.join(userDataDir, 'Cache', 'subdir');

      await fs.mkdir(path.dirname(stateDbPath), { recursive: true });
      await fs.mkdir(workspaceDir, { recursive: true });
      await fs.mkdir(cacheDir, { recursive: true });

      await fs.writeFile(stateDbPath, Buffer.alloc(1024));
      await fs.writeFile(`${stateDbPath}-wal`, Buffer.alloc(256));
      await fs.writeFile(path.join(workspaceDir, 'state.vscdb'), Buffer.alloc(512));
      await fs.writeFile(path.join(cacheDir, 'entry.bin'), Buffer.alloc(128));

      const breakdown = await calculateProfileStorageSize('profile-a', userDataDir);

      assert.equal(breakdown.databaseBytes, 1024);
      assert.equal(breakdown.walBytes, 256);
      assert.equal(breakdown.workspaceStorageBytes, 512);
      assert.equal(breakdown.editorCacheBytes, 128);
      assert.equal(breakdown.totalBytes, 1024 + 256 + 512 + 128);
      assert.equal(breakdown.error, undefined);
    });

    it('excludes deep clean backup files from extension cache size', async () => {
      const userDataDir = path.join(tempRoot, 'profile-backup');
      const stateDbPath = path.join(
        userDataDir,
        'User',
        'globalStorage',
        'state.vscdb'
      );

      await fs.mkdir(path.dirname(stateDbPath), { recursive: true });
      await fs.writeFile(stateDbPath, Buffer.alloc(1024));
      await fs.writeFile(`${stateDbPath}-wal`, Buffer.alloc(256));
      await fs.writeFile(
        `${stateDbPath}.backup-1234567890`,
        Buffer.alloc(5000)
      );

      const breakdown = await calculateProfileStorageSize(
        'profile-backup',
        userDataDir
      );

      assert.equal(breakdown.extensionCacheBytes, 0);
      assert.equal(breakdown.totalBytes, 1024 + 256);
    });

    it('rejects unsafe paths', async () => {
      const breakdown = await calculateProfileStorageSize(
        'profile-b',
        process.platform === 'win32' ? 'C:\\Windows\\Temp\\cursor' : '/etc/cursor'
      );

      assert.ok(breakdown.error);
      assert.equal(breakdown.totalBytes, 0);
    });
  });

  describe('getDirectorySize', () => {
    it('returns zero for missing paths', async () => {
      assert.equal(
        await getDirectorySize(path.join(tempRoot, 'missing-dir')),
        0
      );
    });
  });
});
