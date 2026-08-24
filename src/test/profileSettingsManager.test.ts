import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import { after, before, describe, it } from 'node:test';
import {
  ProfileSettingsError,
  ProfileSettingsManager,
} from '../profiles/profileSettingsManager';

describe('ProfileSettingsManager', () => {
  let tempRoot: string;
  let userDataDir: string;
  const manager = new ProfileSettingsManager();

  before(async () => {
    tempRoot = await fs.mkdtemp(
      path.join(process.cwd(), '.tmp-profile-settings-')
    );
    userDataDir = path.join(tempRoot, 'profile-a');
    await fs.mkdir(path.join(userDataDir, 'User'), { recursive: true });
  });

  after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  describe('readSettings', () => {
    it('parses valid JSON with comments', async () => {
      const settingsPath = path.join(userDataDir, 'User', 'settings.json');
      await fs.writeFile(
        settingsPath,
        `{
          // comment
          "editor.fontSize": 14
        }`,
        'utf-8'
      );

      const settings = await manager.readSettings(userDataDir);
      assert.equal(settings?.['editor.fontSize'], 14);
    });

    it('returns null if file does not exist', async () => {
      const missingDir = path.join(tempRoot, 'missing-profile');
      await fs.mkdir(path.join(missingDir, 'User'), { recursive: true });
      const settings = await manager.readSettings(missingDir);
      assert.equal(settings, null);
    });

    it('throws ProfileSettingsError on invalid JSON', async () => {
      const badDir = path.join(tempRoot, 'bad-json');
      await fs.mkdir(path.join(badDir, 'User'), { recursive: true });
      await fs.writeFile(
        path.join(badDir, 'User', 'settings.json'),
        '{ invalid',
        'utf-8'
      );

      await assert.rejects(
        () => manager.readSettings(badDir),
        (err: unknown) => err instanceof ProfileSettingsError
      );
    });

    it('throws ProfileSettingsError on invalid userDataDir', async () => {
      await assert.rejects(
        () => manager.readSettings('relative/path'),
        (err: unknown) => err instanceof ProfileSettingsError
      );
    });
  });

  describe('writeSettings', () => {
    it('writes settings with pretty print', async () => {
      const writeDir = path.join(tempRoot, 'write-pretty');
      await manager.writeSettings(writeDir, { 'a.b': 1 });
      const content = await fs.readFile(
        path.join(writeDir, 'User', 'settings.json'),
        'utf-8'
      );
      assert.ok(content.includes('\n'));
      assert.ok(content.includes('"a.b": 1'));
    });

    it('creates User directory if not exists', async () => {
      const writeDir = path.join(tempRoot, 'write-mkdir');
      await manager.writeSettings(writeDir, {});
      const stat = await fs.stat(path.join(writeDir, 'User', 'settings.json'));
      assert.ok(stat.isFile());
    });
  });

  describe('applyProxySettings', () => {
    it('sets proxy keys when no existing proxy', async () => {
      const dir = path.join(tempRoot, 'apply-fresh');
      await manager.applyProxySettings(dir, 'http://127.0.0.1:8080');
      const settings = await manager.readSettings(dir);
      assert.equal(settings?.['http.proxy'], 'http://127.0.0.1:8080');
      assert.equal(settings?.['http.proxySupport'], 'override');
      assert.equal(settings?.['http.proxyStrictSSL'], false);
      assert.equal(settings?.['cursor.general.disableHttp2'], true);
      assert.equal(settings?.['http.proxy.backup'], undefined);
    });

    it('backs up existing proxy before overwriting', async () => {
      const dir = path.join(tempRoot, 'apply-backup');
      await manager.writeSettings(dir, {
        'http.proxy': 'http://corporate:3128',
      });
      await manager.applyProxySettings(dir, 'http://127.0.0.1:8080');
      const settings = await manager.readSettings(dir);
      assert.equal(settings?.['http.proxy'], 'http://127.0.0.1:8080');
      assert.equal(settings?.['http.proxy.backup'], 'http://corporate:3128');
    });

    it('is idempotent when same proxy URL already applied', async () => {
      const dir = path.join(tempRoot, 'apply-idempotent');
      await manager.applyProxySettings(dir, 'http://127.0.0.1:8080');
      const before = await fs.readFile(
        path.join(dir, 'User', 'settings.json'),
        'utf-8'
      );
      await manager.applyProxySettings(dir, 'http://127.0.0.1:8080');
      const after = await fs.readFile(
        path.join(dir, 'User', 'settings.json'),
        'utf-8'
      );
      assert.equal(before, after);
    });

    it('adds disableHttp2 when proxy URL already set but flag missing', async () => {
      const dir = path.join(tempRoot, 'apply-disable-http2-missing');
      await manager.writeSettings(dir, {
        'http.proxy': 'http://127.0.0.1:8080',
        'http.proxySupport': 'override',
        'http.proxyStrictSSL': false,
      });
      await manager.applyProxySettings(dir, 'http://127.0.0.1:8080');
      const settings = await manager.readSettings(dir);
      assert.equal(settings?.['cursor.general.disableHttp2'], true);
    });
  });

  describe('restoreProxySettings', () => {
    it('restores from backup and deletes backup key', async () => {
      const dir = path.join(tempRoot, 'restore-backup');
      await manager.writeSettings(dir, {
        'http.proxy': 'http://127.0.0.1:8080',
        'http.proxy.backup': 'http://corporate:3128',
        'http.proxySupport': 'override',
        'http.proxyStrictSSL': false,
      });
      await manager.restoreProxySettings(dir);
      const settings = await manager.readSettings(dir);
      assert.equal(settings?.['http.proxy'], 'http://corporate:3128');
      assert.equal(settings?.['http.proxy.backup'], undefined);
      assert.equal(settings?.['http.proxySupport'], undefined);
      assert.equal(settings?.['cursor.general.disableHttp2'], undefined);
    });

    it('clears our proxy keys when no backup exists', async () => {
      const dir = path.join(tempRoot, 'restore-clear');
      await manager.applyProxySettings(dir, 'http://127.0.0.1:8080');
      await manager.restoreProxySettings(dir);
      const settings = await manager.readSettings(dir);
      assert.equal(settings?.['http.proxy'], undefined);
      assert.equal(settings?.['http.proxySupport'], undefined);
      assert.equal(settings?.['cursor.general.disableHttp2'], undefined);
    });

    it('is idempotent when no proxy was applied', async () => {
      const dir = path.join(tempRoot, 'restore-idempotent');
      await manager.restoreProxySettings(dir);
      const settings = await manager.readSettings(dir);
      assert.equal(settings, null);
    });
  });

  describe('getProxyBackupInfo', () => {
    it('returns hasBackup=true when backup exists', async () => {
      const dir = path.join(tempRoot, 'info-backup');
      await manager.writeSettings(dir, {
        'http.proxy': 'http://127.0.0.1:8080',
        'http.proxy.backup': 'http://old:8080',
      });
      const info = await manager.getProxyBackupInfo(dir);
      assert.equal(info.hasBackup, true);
      assert.equal(info.backupProxyUrl, 'http://old:8080');
    });

    it('handles missing settings.json gracefully', async () => {
      const dir = path.join(tempRoot, 'info-missing');
      const info = await manager.getProxyBackupInfo(dir);
      assert.equal(info.hasBackup, false);
    });
  });
});
