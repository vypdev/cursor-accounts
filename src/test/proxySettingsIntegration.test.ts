import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { after, before, describe, it } from 'node:test';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import { ProfileSettingsManager } from '../profiles/profileSettingsManager';
import { ProxySettingsService } from '../services/proxySettingsService';
import type { Profile } from '../profiles/types';

describe('Proxy settings integration', () => {
  let tempRoot: string;
  let profileDir: string;
  const settingsManager = new ProfileSettingsManager();

  before(async () => {
    tempRoot = await fs.mkdtemp(
      path.join(os.homedir(), '.cursor-accounts-test-proxy-int-')
    );
    profileDir = path.join(tempRoot, 'profile-one');
  });

  after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('applies proxy on launch path and restores on stop flow', async () => {
    await settingsManager.applyProxySettings(
      profileDir,
      'http://127.0.0.1:8080'
    );
    let settings = await settingsManager.readSettings(profileDir);
    assert.equal(settings?.['http.proxy'], 'http://127.0.0.1:8080');

    await settingsManager.restoreProxySettings(profileDir);
    settings = await settingsManager.readSettings(profileDir);
    assert.equal(settings?.['http.proxy'], undefined);
  });

  it('restores user proxy from backup after temporary override', async () => {
    const dir = path.join(tempRoot, 'profile-backup');
    await settingsManager.writeSettings(dir, {
      'http.proxy': 'http://corporate:3128',
    });
    await settingsManager.applyProxySettings(dir, 'http://127.0.0.1:8080');

    const profile: Profile = {
      id: 'backup-profile',
      email: 'u@example.com',
      slug: 'backup',
      displayName: 'Backup',
      userDataDir: dir,
      created: new Date().toISOString(),
    };

    const profileManager = {
      getProfiles: async () => [profile],
    } as unknown as IProfileManager;

    const service = new ProxySettingsService(profileManager, settingsManager);
    await service.restoreAllProfiles();

    const settings = await settingsManager.readSettings(dir);
    assert.equal(settings?.['http.proxy'], 'http://corporate:3128');
    assert.equal(settings?.['http.proxy.backup'], undefined);
  });

  it('restoreAllProfiles clears temporary proxy on default-window simulation', async () => {
    const dir = path.join(tempRoot, 'profile-default-restore');
    await settingsManager.applyProxySettings(dir, 'http://127.0.0.1:8081');

    const profile: Profile = {
      id: 'default-restore',
      email: 'd@example.com',
      slug: 'default',
      displayName: 'Default',
      userDataDir: dir,
      created: new Date().toISOString(),
    };

    const profileManager = {
      getProfiles: async () => [profile],
    } as unknown as IProfileManager;

    const service = new ProxySettingsService(profileManager, settingsManager);
    const result = await service.restoreAllProfiles();
    assert.equal(result.restored, 1);
    assert.equal(result.errors.length, 0);

    const settings = await settingsManager.readSettings(dir);
    assert.equal(settings?.['http.proxy'], undefined);
  });
});
