import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as os from 'os';
import * as path from 'path';
import {
  ensureDirectory,
  normalizePath,
  pathsEqual,
  validateStateDbPath,
  validateUserDataPath,
} from '../utils/pathUtils';

describe('pathUtils', () => {
  describe('normalizePath', () => {
    it('converts relative to absolute path', () => {
      const normalized = normalizePath('./test');
      assert.ok(path.isAbsolute(normalized));
    });

    it('handles paths with .. correctly', () => {
      const normalized = normalizePath('/test/foo/../bar');
      assert.equal(normalized, normalizePath('/test/bar'));
    });

    it('removes trailing slashes', () => {
      const normalized = normalizePath('/test/path/');
      assert.ok(!normalized.endsWith(path.sep));
    });

    it('preserves root separator', () => {
      if (process.platform !== 'win32') {
        const normalized = normalizePath('/');
        assert.equal(normalized, '/');
      }
    });

    it('is case-insensitive on Windows', () => {
      if (process.platform === 'win32') {
        const path1 = normalizePath('C:\\Users\\Test');
        const path2 = normalizePath('c:\\users\\test');
        assert.equal(path1, path2);
      }
    });

    it('is case-sensitive on Unix', () => {
      if (process.platform !== 'win32') {
        const path1 = normalizePath('/Users/Test');
        const path2 = normalizePath('/users/test');
        assert.notEqual(path1, path2);
      }
    });
  });

  describe('pathsEqual', () => {
    it('returns true for same paths', () => {
      const home = os.homedir();
      assert.ok(pathsEqual(home, home));
    });

    it('returns true for equivalent paths', () => {
      const path1 = normalizePath('/test/path');
      const path2 = normalizePath('/test/path');
      assert.ok(pathsEqual(path1, path2));
    });

    it('returns false for different paths', () => {
      const path1 = normalizePath('/test/path1');
      const path2 = normalizePath('/test/path2');
      assert.ok(!pathsEqual(path1, path2));
    });
  });

  describe('validateUserDataPath', () => {
    it('accepts path within home directory', () => {
      const validPath = path.join(os.homedir(), '.cursor-test');
      const result = validateUserDataPath(validPath);
      assert.equal(result.valid, true);
    });

    it('rejects relative paths', () => {
      const result = validateUserDataPath('./test');
      assert.equal(result.valid, false);
      assert.ok(result.error?.includes('absolute'));
    });

    it('rejects paths outside home directory', () => {
      const result = validateUserDataPath('/tmp/test');
      assert.equal(result.valid, false);
      assert.ok(result.error?.includes('home directory'));
    });

    it('rejects sibling paths that only share the home directory prefix', () => {
      const siblingPath = `${os.homedir()}-other/.cursor-profile`;
      const result = validateUserDataPath(siblingPath);

      assert.equal(result.valid, false);
      assert.ok(result.error?.includes('home directory'));
    });

    it('rejects home directory itself', () => {
      const result = validateUserDataPath(os.homedir());
      assert.equal(result.valid, false);
      assert.ok(result.error?.includes('home directory itself'));
    });

    it('rejects system directories', () => {
      const systemPath =
        process.platform === 'win32' ? 'C:\\Windows\\test' : '/usr/test';
      const result = validateUserDataPath(systemPath);
      assert.equal(result.valid, false);
      assert.ok(result.error);
    });
  });

  describe('validateStateDbPath', () => {
    it('accepts paths within home directory', () => {
      const dbPath = path.join(
        os.homedir(),
        '.cursor-test',
        'User',
        'globalStorage',
        'state.vscdb'
      );
      assert.doesNotThrow(() => validateStateDbPath(dbPath));
    });

    it('rejects paths outside home directory', () => {
      assert.throws(
        () => validateStateDbPath('/etc/passwd'),
        /within user home directory/
      );
    });

    it('rejects sibling paths that only share the home directory prefix', () => {
      const siblingPath = `${os.homedir()}-other/.cursor-profile/User/state.vscdb`;

      assert.throws(
        () => validateStateDbPath(siblingPath),
        /within user home directory/
      );
    });
  });

  describe('ensureDirectory', () => {
    it('creates directory if it does not exist', async () => {
      const fs = await import('fs/promises');
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'cursor-accounts-pathutils-')
      );
      const newDir = path.join(tempDir, 'nested', 'dir');

      try {
        await ensureDirectory(newDir);
        const stats = await fs.stat(newDir);
        assert.ok(stats.isDirectory());
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('throws if path exists but is not a directory', async () => {
      const fs = await import('fs/promises');
      const tempFile = path.join(
        os.tmpdir(),
        `cursor-accounts-pathutils-${Date.now()}.txt`
      );

      try {
        await fs.writeFile(tempFile, 'test', 'utf-8');
        await assert.rejects(
          () => ensureDirectory(tempFile),
          /not a directory/
        );
      } finally {
        await fs.rm(tempFile, { force: true });
      }
    });
  });
});
