import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile } from '@cursor-accounts/types';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import {
  ProfileProxyLaunchCoordinator,
  type ProfileProxyManager,
} from '../profiles/profileProxyLaunchCoordinator';

function createProfile(proxyEnabled?: boolean): Profile {
  return {
    id: 'profile-1',
    email: 'profile@example.com',
    slug: 'profile-1',
    displayName: 'Profile 1',
    userDataDir: '/tmp/profile-1',
    created: '2026-01-01T00:00:00.000Z',
    proxyEnabled,
  };
}

describe('ProfileProxyLaunchCoordinator', () => {
  it('does not touch the proxy when the profile explicitly disables it', async () => {
    let isRunningCalls = 0;
    const proxyManager = {
      isRunning: async () => {
        isRunningCalls += 1;
        return false;
      },
    } as unknown as ProfileProxyManager;
    const coordinator = new ProfileProxyLaunchCoordinator(proxyManager);

    const context = await coordinator.resolve(createProfile(false), '/tmp/profile-1');

    assert.equal(context, null);
    assert.equal(isRunningCalls, 0);
  });

  it('starts the profile proxy and returns its URL and certificate', async () => {
    const calls: string[] = [];
    const proxyManager = {
      isRunning: async (profileId: string) => {
        calls.push(`isRunning:${profileId}`);
        return false;
      },
      ensureProfileProxy: async (profileId: string) => {
        calls.push(`ensure:${profileId}`);
        return { success: true, port: 8080 };
      },
      getProxyServerUrl: async (profileId: string) => {
        calls.push(`url:${profileId}`);
        return 'http://127.0.0.1:8080';
      },
      getCertificatePath: async () => '/tmp/cursor-ca.pem',
    } as unknown as ProfileProxyManager;
    const settingsManager = {
      applyProxySettings: async (userDataDir: string, proxyUrl: string) => {
        calls.push(`settings:${userDataDir}:${proxyUrl}`);
      },
    } as unknown as IProfileSettingsManager;
    const coordinator = new ProfileProxyLaunchCoordinator(
      proxyManager,
      settingsManager
    );

    const context = await coordinator.resolve(createProfile(), '/tmp/profile-1');

    assert.deepEqual(context, {
      proxyUrl: 'http://127.0.0.1:8080',
      caCertPath: '/tmp/cursor-ca.pem',
    });
    assert.deepEqual(calls, [
      'isRunning:profile-1',
      'ensure:profile-1',
      'url:profile-1',
      'settings:/tmp/profile-1:http://127.0.0.1:8080',
    ]);
  });

  it('continues launching when applying profile settings fails', async () => {
    const proxyManager = {
      isRunning: async () => true,
      getProxyServerUrl: async () => 'http://127.0.0.1:8081',
      getCertificatePath: async () => null,
    } as unknown as ProfileProxyManager;
    const coordinator = new ProfileProxyLaunchCoordinator(
      proxyManager,
      {
        applyProxySettings: async () => {
          throw new Error('settings locked');
        },
      } as unknown as IProfileSettingsManager
    );

    const context = await coordinator.resolve(createProfile(), '/tmp/profile-1');

    assert.deepEqual(context, {
      proxyUrl: 'http://127.0.0.1:8081',
      caCertPath: '',
    });
  });

  it('returns no launch context when starting the proxy fails', async () => {
    let urlCalls = 0;
    const proxyManager = {
      isRunning: async () => false,
      ensureProfileProxy: async () => ({
        success: false,
        error: 'certificate unavailable',
      }),
      getProxyServerUrl: async () => {
        urlCalls += 1;
        return 'http://127.0.0.1:8080';
      },
    } as unknown as ProfileProxyManager;
    const coordinator = new ProfileProxyLaunchCoordinator(proxyManager);

    const context = await coordinator.resolve(createProfile(), '/tmp/profile-1');

    assert.equal(context, null);
    assert.equal(urlCalls, 0);
  });
});
