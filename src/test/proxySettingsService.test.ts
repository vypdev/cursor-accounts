import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'node:test';
import type { IInstanceDetector } from '../domain/ports/IInstanceDetector';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type {
  IProfileSettingsManager,
  ProxyBackupInfo,
} from '../domain/ports/IProfileSettingsManager';
import type { IProxyWindowConfiguration } from '../domain/ports/IProxyWindowConfiguration';
import { ProxySettingsApplicationService } from '../application/services/proxySettingsApplicationService';
import { ProxySettingsBackupReader } from '../application/services/proxySettingsBackupReader';
import { ProxySettingsRestorationService } from '../application/services/proxySettingsRestorationService';
import type { Profile } from '../profiles/types';

function createProfile(id: string, userDataDir: string): Profile {
  return {
    id,
    email: `${id}@example.com`,
    slug: id,
    displayName: id,
    userDataDir,
    created: new Date().toISOString(),
  };
}

function createProfileReader(profiles: Profile[]): IProfileReader {
  return {
    getProfiles: async () => profiles,
    getProfile: async (id) => profiles.find((profile) => profile.id === id),
    findProfileByEmail: async (email) =>
      profiles.find((profile) => profile.email === email),
    findProfileByPath: async (userDataDir) =>
      profiles.find((profile) => profile.userDataDir === userDataDir),
  };
}

function createProfileSettingsManager(
  overrides: Partial<IProfileSettingsManager> = {}
): IProfileSettingsManager {
  return {
    readSettings: async () => null,
    writeSettings: async () => undefined,
    applyProxySettings: async () => undefined,
    restoreProxySettings: async () => undefined,
    getProxyBackupInfo: async () => ({ hasBackup: false }),
    ...overrides,
  };
}

function createWindowConfiguration(
  overrides: Partial<IProxyWindowConfiguration> = {}
): IProxyWindowConfiguration {
  return {
    syncProxy: async () => undefined,
    clearProxy: async () => undefined,
    ...overrides,
  };
}

function createRestorationService(
  profileReader: IProfileReader,
  profileSettingsManager: IProfileSettingsManager,
  windowConfiguration: IProxyWindowConfiguration = createWindowConfiguration()
): ProxySettingsRestorationService {
  return new ProxySettingsRestorationService({
    profileReader,
    profileSettingsManager,
    windowConfiguration,
    error: () => undefined,
    debug: () => undefined,
  });
}

describe('Proxy settings application and restoration boundaries', () => {
  describe('ProxySettingsRestorationService', () => {
    it('restores all profiles successfully', async () => {
      const restored: string[] = [];
      const profiles = [
        createProfile('a', path.join(os.homedir(), '.cursor-accounts-test-a')),
        createProfile('b', path.join(os.homedir(), '.cursor-accounts-test-b')),
      ];
      const profileSettingsManager = createProfileSettingsManager({
        restoreProxySettings: async (dir) => {
          restored.push(dir);
        },
      });

      const result = await createRestorationService(
        createProfileReader(profiles),
        profileSettingsManager
      ).restoreAllProfiles();

      assert.equal(result.restored, 2);
      assert.equal(result.errors.length, 0);
      assert.deepEqual(restored.sort(), profiles.map((p) => p.userDataDir).sort());
    });

    it('collects errors and continues on partial failures', async () => {
      const profiles = [
        createProfile('ok', path.join(os.homedir(), '.cursor-accounts-test-ok')),
        createProfile('fail', path.join(os.homedir(), '.cursor-accounts-test-fail')),
      ];
      const profileSettingsManager = createProfileSettingsManager({
        restoreProxySettings: async (dir) => {
          if (dir.endsWith('test-fail')) {
            throw new Error('disk error');
          }
        },
      });

      const result = await createRestorationService(
        createProfileReader(profiles),
        profileSettingsManager
      ).restoreAllProfiles();

      assert.equal(result.restored, 1);
      assert.deepEqual(result.errors, [{ profileId: 'fail', error: 'disk error' }]);
    });

    it('handles an empty profile list', async () => {
      const result = await createRestorationService(
        createProfileReader([]),
        createProfileSettingsManager()
      ).restoreAllProfiles();

      assert.deepEqual(result, { restored: 0, errors: [] });
    });
  });

  describe('ProxySettingsApplicationService', () => {
    it('applies a proxy to one profile without changing window state', async () => {
      const applied: Array<{ dir: string; url: string }> = [];
      let syncCount = 0;
      const profileSettingsManager = createProfileSettingsManager({
        applyProxySettings: async (dir, url) => {
          applied.push({ dir, url });
        },
      });
      const service = new ProxySettingsApplicationService({
        profileReader: createProfileReader([]),
        profileSettingsManager,
        windowConfiguration: createWindowConfiguration({
          syncProxy: async () => {
            syncCount += 1;
          },
        }),
        warn: () => undefined,
      });

      await service.applyProxySettings(
        '/tmp/cursor-accounts-test-single-profile',
        'http://127.0.0.1:8083'
      );

      assert.deepEqual(applied, [
        {
          dir: '/tmp/cursor-accounts-test-single-profile',
          url: 'http://127.0.0.1:8083',
        },
      ]);
      assert.equal(syncCount, 0);
    });

    it('applies proxy URL to every profile and syncs the active window', async () => {
      const applied: Array<{ dir: string; url: string }> = [];
      let syncedUrl: string | undefined;
      const profiles = [
        createProfile('a', path.join(os.homedir(), '.cursor-accounts-test-apply-a')),
        createProfile('b', path.join(os.homedir(), '.cursor-accounts-test-apply-b')),
      ];
      const windowConfiguration = createWindowConfiguration({
        syncProxy: async (url) => {
          syncedUrl = url;
        },
      });
      const profileSettingsManager = createProfileSettingsManager({
        applyProxySettings: async (dir, url) => {
          applied.push({ dir, url });
        },
      });

      const service = new ProxySettingsApplicationService({
        profileReader: createProfileReader(profiles),
        profileSettingsManager,
        windowConfiguration,
        warn: () => undefined,
      });
      await service.applyProxyForAllProfiles('http://127.0.0.1:8080');

      assert.equal(applied.length, 2);
      assert.ok(applied.every((entry) => entry.url === 'http://127.0.0.1:8080'));
      assert.equal(syncedUrl, 'http://127.0.0.1:8080');
    });

    it('continues applying other profiles when one apply fails', async () => {
      const applied: string[] = [];
      const profiles = [
        createProfile('ok', path.join(os.homedir(), '.cursor-accounts-test-apply-ok')),
        createProfile('fail', path.join(os.homedir(), '.cursor-accounts-test-apply-fail')),
      ];
      const profileSettingsManager = createProfileSettingsManager({
        applyProxySettings: async (dir) => {
          if (dir.endsWith('apply-fail')) {
            throw new Error('write failed');
          }
          applied.push(dir);
        },
      });
      const service = new ProxySettingsApplicationService({
        profileReader: createProfileReader(profiles),
        profileSettingsManager,
        windowConfiguration: createWindowConfiguration(),
        warn: () => undefined,
      });

      await service.applyProxyForAllProfiles('http://127.0.0.1:8081');

      assert.deepEqual(applied, [profiles[0]!.userDataDir]);
    });

    it('applies proxy only to profiles with running instances', async () => {
      const applied: string[] = [];
      const profiles = [
        createProfile('running', path.join(os.homedir(), '.cursor-accounts-test-running')),
        createProfile('idle', path.join(os.homedir(), '.cursor-accounts-test-idle')),
      ];
      const profileSettingsManager = createProfileSettingsManager({
        applyProxySettings: async (dir) => {
          applied.push(dir);
        },
      });
      const instanceDetector = {
        detectRunningInstances: async () =>
          new Map([['running', {} as never]]),
      } as unknown as IInstanceDetector;
      const service = new ProxySettingsApplicationService({
        profileReader: createProfileReader(profiles),
        profileSettingsManager,
        windowConfiguration: createWindowConfiguration(),
        instanceDetector,
        warn: () => undefined,
      });

      await service.applyProxyForRunningProfiles('http://127.0.0.1:8082');

      assert.deepEqual(applied, [profiles[0]!.userDataDir]);
    });

    it('does nothing when the instance detector is not configured', async () => {
      let applyCount = 0;
      const profileSettingsManager = createProfileSettingsManager({
        applyProxySettings: async () => {
          applyCount += 1;
        },
      });
      const service = new ProxySettingsApplicationService({
        profileReader: createProfileReader([
          createProfile('p', path.join(os.homedir(), '.cursor-accounts-test-no-detector')),
        ]),
        profileSettingsManager,
        windowConfiguration: createWindowConfiguration(),
        warn: () => undefined,
      });

      await service.applyProxyForRunningProfiles('http://127.0.0.1:8083');

      assert.equal(applyCount, 0);
    });
  });

  describe('ProxySettingsBackupReader', () => {
    it('returns backup information keyed by profile id', async () => {
      const profile = createProfile(
        'p1',
        path.join(os.homedir(), '.cursor-accounts-test-p1')
      );
      const info: ProxyBackupInfo = {
        hasBackup: true,
        backupProxyUrl: 'http://old:8080',
      };
      const reader = new ProxySettingsBackupReader({
        profileReader: createProfileReader([profile]),
        profileSettingsManager: createProfileSettingsManager({
          getProxyBackupInfo: async () => info,
        }),
        debug: () => undefined,
      });

      const result = await reader.getAllProxyBackupInfo();

      assert.deepEqual(result.get('p1'), info);
    });
  });
});
