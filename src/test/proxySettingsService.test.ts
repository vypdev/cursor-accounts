import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'node:test';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type {
  IProfileSettingsManager,
  ProxyBackupInfo,
} from '../domain/ports/IProfileSettingsManager';
import { ProxySettingsService } from '../services/proxySettingsService';
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

describe('ProxySettingsService', () => {
  describe('restoreAllProfiles', () => {
    it('restores all profiles successfully', async () => {
      const restored: string[] = [];
      const profileManager = {
        getProfiles: async () => [
          createProfile('a', path.join(os.homedir(), '.cursor-accounts-test-a')),
          createProfile('b', path.join(os.homedir(), '.cursor-accounts-test-b')),
        ],
      } as unknown as IProfileManager;

      const profileSettingsManager: IProfileSettingsManager = {
        readSettings: async () => null,
        writeSettings: async () => undefined,
        applyProxySettings: async () => undefined,
        restoreProxySettings: async (dir) => {
          restored.push(dir);
        },
        getProxyBackupInfo: async () => ({ hasBackup: false }),
      };

      const service = new ProxySettingsService(
        profileManager,
        profileSettingsManager
      );
      const result = await service.restoreAllProfiles();
      assert.equal(result.restored, 2);
      assert.equal(result.errors.length, 0);
      assert.deepEqual(
        restored.sort(),
        [
          path.join(os.homedir(), '.cursor-accounts-test-a'),
          path.join(os.homedir(), '.cursor-accounts-test-b'),
        ].sort()
      );
    });

    it('collects errors and continues on partial failures', async () => {
      const profileManager = {
        getProfiles: async () => [
          createProfile('ok', path.join(os.homedir(), '.cursor-accounts-test-ok')),
          createProfile('fail', path.join(os.homedir(), '.cursor-accounts-test-fail')),
        ],
      } as unknown as IProfileManager;

      const profileSettingsManager: IProfileSettingsManager = {
        readSettings: async () => null,
        writeSettings: async () => undefined,
        applyProxySettings: async () => undefined,
        restoreProxySettings: async (dir) => {
          if (dir === path.join(os.homedir(), '.cursor-accounts-test-fail')) {
            throw new Error('disk error');
          }
        },
        getProxyBackupInfo: async () => ({ hasBackup: false }),
      };

      const service = new ProxySettingsService(
        profileManager,
        profileSettingsManager
      );
      const result = await service.restoreAllProfiles();
      assert.equal(result.restored, 1);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0]?.profileId, 'fail');
    });

    it('handles empty profile list', async () => {
      const profileManager = {
        getProfiles: async () => [],
      } as unknown as IProfileManager;

      const profileSettingsManager: IProfileSettingsManager = {
        readSettings: async () => null,
        writeSettings: async () => undefined,
        applyProxySettings: async () => undefined,
        restoreProxySettings: async () => undefined,
        getProxyBackupInfo: async () => ({ hasBackup: false }),
      };

      const service = new ProxySettingsService(
        profileManager,
        profileSettingsManager
      );
      const result = await service.restoreAllProfiles();
      assert.equal(result.restored, 0);
      assert.equal(result.errors.length, 0);
    });
  });

  describe('applyProxyForAllProfiles', () => {
    it('applies proxy URL to every profile and syncs active window', async () => {
      const applied: Array<{ dir: string; url: string }> = [];
      let syncedUrl: string | undefined;

      const profileManager = {
        getProfiles: async () => [
          createProfile('a', path.join(os.homedir(), '.cursor-accounts-test-apply-a')),
          createProfile('b', path.join(os.homedir(), '.cursor-accounts-test-apply-b')),
        ],
      } as unknown as IProfileManager;

      const profileSettingsManager: IProfileSettingsManager = {
        readSettings: async () => null,
        writeSettings: async () => undefined,
        applyProxySettings: async (dir, url) => {
          applied.push({ dir, url });
        },
        restoreProxySettings: async () => undefined,
        getProxyBackupInfo: async () => ({ hasBackup: false }),
      };

      const syncModule = await import('../proxy/syncProxyVscodeConfiguration.js');
      const originalSync = syncModule.syncProxyVscodeConfiguration;
      syncModule.syncProxyVscodeConfiguration = async (url: string) => {
        syncedUrl = url;
      };

      try {
        const service = new ProxySettingsService(
          profileManager,
          profileSettingsManager
        );
        await service.applyProxyForAllProfiles('http://127.0.0.1:8080');
        assert.equal(applied.length, 2);
        assert.ok(applied.every((a) => a.url === 'http://127.0.0.1:8080'));
        assert.equal(syncedUrl, 'http://127.0.0.1:8080');
      } finally {
        syncModule.syncProxyVscodeConfiguration = originalSync;
      }
    });

    it('continues applying other profiles when one apply fails', async () => {
      const applied: string[] = [];
      const profileManager = {
        getProfiles: async () => [
          createProfile('ok', path.join(os.homedir(), '.cursor-accounts-test-apply-ok')),
          createProfile('fail', path.join(os.homedir(), '.cursor-accounts-test-apply-fail')),
        ],
      } as unknown as IProfileManager;

      const profileSettingsManager: IProfileSettingsManager = {
        readSettings: async () => null,
        writeSettings: async () => undefined,
        applyProxySettings: async (dir) => {
          if (dir.includes('apply-fail')) {
            throw new Error('write failed');
          }
          applied.push(dir);
        },
        restoreProxySettings: async () => undefined,
        getProxyBackupInfo: async () => ({ hasBackup: false }),
      };

      const syncModule = await import('../proxy/syncProxyVscodeConfiguration.js');
      const originalSync = syncModule.syncProxyVscodeConfiguration;
      syncModule.syncProxyVscodeConfiguration = async () => undefined;

      try {
        const service = new ProxySettingsService(
          profileManager,
          profileSettingsManager
        );
        await service.applyProxyForAllProfiles('http://127.0.0.1:8081');
        assert.equal(applied.length, 1);
        assert.ok(applied[0]?.includes('apply-ok'));
      } finally {
        syncModule.syncProxyVscodeConfiguration = originalSync;
      }
    });
  });

  describe('applyProxyForRunningProfiles', () => {
    it('applies proxy only to profiles with running instances', async () => {
      const applied: string[] = [];
      const profileManager = {
        getProfiles: async () => [
          createProfile('running', path.join(os.homedir(), '.cursor-accounts-test-running')),
          createProfile('idle', path.join(os.homedir(), '.cursor-accounts-test-idle')),
        ],
      } as unknown as IProfileManager;

      const profileSettingsManager: IProfileSettingsManager = {
        readSettings: async () => null,
        writeSettings: async () => undefined,
        applyProxySettings: async (dir) => {
          applied.push(dir);
        },
        restoreProxySettings: async () => undefined,
        getProxyBackupInfo: async () => ({ hasBackup: false }),
      };

      const instanceDetector = {
        detectRunningInstances: async () => new Set(['running']),
      };

      const syncModule = await import('../proxy/syncProxyVscodeConfiguration.js');
      const originalSync = syncModule.syncProxyVscodeConfiguration;
      syncModule.syncProxyVscodeConfiguration = async () => undefined;

      try {
        const service = new ProxySettingsService(
          profileManager,
          profileSettingsManager,
          instanceDetector as never
        );
        await service.applyProxyForRunningProfiles('http://127.0.0.1:8082');
        assert.equal(applied.length, 1);
        assert.ok(applied[0]?.includes('test-running'));
      } finally {
        syncModule.syncProxyVscodeConfiguration = originalSync;
      }
    });

    it('no-ops when instance detector is not configured', async () => {
      const profileManager = {
        getProfiles: async () => [
          createProfile('p', path.join(os.homedir(), '.cursor-accounts-test-no-detector')),
        ],
      } as unknown as IProfileManager;

      let applyCount = 0;
      const profileSettingsManager: IProfileSettingsManager = {
        readSettings: async () => null,
        writeSettings: async () => undefined,
        applyProxySettings: async () => {
          applyCount += 1;
        },
        restoreProxySettings: async () => undefined,
        getProxyBackupInfo: async () => ({ hasBackup: false }),
      };

      const service = new ProxySettingsService(
        profileManager,
        profileSettingsManager
      );
      await service.applyProxyForRunningProfiles('http://127.0.0.1:8083');
      assert.equal(applyCount, 0);
    });
  });

  describe('getAllProxyBackupInfo', () => {
    it('returns map with backup info for all profiles', async () => {
      const profileManager = {
        getProfiles: async () => [
          createProfile('p1', path.join(os.homedir(), '.cursor-accounts-test-p1')),
        ],
      } as unknown as IProfileManager;

      const profileSettingsManager: IProfileSettingsManager = {
        readSettings: async () => null,
        writeSettings: async () => undefined,
        applyProxySettings: async () => undefined,
        restoreProxySettings: async () => undefined,
        getProxyBackupInfo: async (): Promise<ProxyBackupInfo> => ({
          hasBackup: true,
          backupProxyUrl: 'http://old:8080',
        }),
      };

      const service = new ProxySettingsService(
        profileManager,
        profileSettingsManager
      );
      const map = await service.getAllProxyBackupInfo();
      assert.equal(map.get('p1')?.hasBackup, true);
    });
  });
});
