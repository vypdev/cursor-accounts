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
