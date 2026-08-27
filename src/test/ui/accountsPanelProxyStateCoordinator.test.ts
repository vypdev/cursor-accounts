import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile, ProxyStatus, ToWebviewMessage } from '@cursor-accounts/types';
import type { IProfileDetector } from '../../domain/ports/IProfileDetector';
import type { IProxyPanelRead } from '../../domain/ports/IProxyPanelRead';
import type { ProxyBackupInfo } from '../../domain/ports/IProfileSettingsManager';
import type { IProxySettingsBackupReader } from '../../domain/ports/IProxySettingsBackupReader';
import { AccountsPanelProxyStateCoordinator } from '../../ui/accountsPanelProxyStateCoordinator';

const PROFILE: Profile = {
  id: 'profile-1',
  email: 'profile-1@example.com',
  slug: 'profile-1',
  displayName: 'Profile 1',
  userDataDir: '/profiles/profile-1',
  created: '2026-01-01T00:00:00.000Z',
  proxyEnabled: true,
};

const STATUS: ProxyStatus = {
  running: true,
  port: 8080,
};

function createCoordinator({
  active = true,
  currentProfile = PROFILE,
  status = STATUS,
  certificateInstalled = true,
  cachedCertificateInstalled = false,
  backupInfo = new Map(),
}: {
  active?: boolean;
  currentProfile?: Profile | null;
  status?: ProxyStatus | null;
  certificateInstalled?: boolean;
  cachedCertificateInstalled?: boolean;
  backupInfo?: Map<string, ProxyBackupInfo>;
} = {}) {
  const postedMessages: ToWebviewMessage[] = [];
  const detector = {
    detectCurrentProfile: async () => currentProfile,
  } as unknown as IProfileDetector;
  const manager: IProxyPanelRead = {
    getStatus: async () => status,
    isCurrentWindowUsingProxy: async () => true,
    checkCertificateInstalled: async () => certificateInstalled,
    getCachedCertificateInstalled: () => cachedCertificateInstalled,
    getProxyServerUrl: async (profileId) =>
      profileId === 'profile-2' ? 'http://127.0.0.1:8080' : null,
  };
  const settingsReader: IProxySettingsBackupReader = {
    getAllProxyBackupInfo: async () => backupInfo,
  };
  const coordinator = new AccountsPanelProxyStateCoordinator(
    {
      profileDetector: detector,
      proxyManager: manager,
      proxySettingsReader: settingsReader,
    },
    {
      postMessage: async (message) => {
        postedMessages.push(message);
      },
      hasActiveWebview: () => active,
    }
  );

  return { coordinator, postedMessages };
}

describe('AccountsPanelProxyStateCoordinator', () => {
  it('returns an empty disabled state without reading proxy capabilities', async () => {
    const setup = createCoordinator({ currentProfile: { ...PROFILE, proxyEnabled: false } });

    assert.deepEqual(
      await setup.coordinator.read({ ...PROFILE, proxyEnabled: false }),
      {
        proxyStatus: null,
        currentWindowUsesProxy: false,
        profileProxyTemporary: {},
      }
    );
  });

  it('reads certificate status and identifies temporary profile proxies', async () => {
    const setup = createCoordinator({
      backupInfo: new Map([
        ['profile-1', { hasBackup: true }],
        [
          'profile-2',
          { hasBackup: false, currentProxyUrl: 'http://127.0.0.1:8080' },
        ],
        ['profile-3', { hasBackup: false, currentProxyUrl: 'http://other' }],
      ]),
    });

    assert.deepEqual(await setup.coordinator.read(PROFILE, { checkCertificate: true }), {
      proxyStatus: { ...STATUS, caCertificateInstalled: true },
      currentWindowUsesProxy: true,
      profileProxyTemporary: { 'profile-1': true, 'profile-2': true },
    });
  });

  it('uses the cached certificate state when a live check is not requested', async () => {
    const setup = createCoordinator({ cachedCertificateInstalled: true });

    assert.deepEqual(await setup.coordinator.read(PROFILE), {
      proxyStatus: { ...STATUS, caCertificateInstalled: true },
      currentWindowUsesProxy: true,
      profileProxyTemporary: {},
    });
  });

  it('publishes both proxy projections for the current active profile', async () => {
    const setup = createCoordinator();

    await setup.coordinator.refresh({ checkCertificate: true });

    assert.deepEqual(setup.postedMessages, [
      { type: 'proxyStatus', data: { ...STATUS, caCertificateInstalled: true } },
      { type: 'currentWindowProxyUsage', usesProxy: true },
    ]);
  });

  it('does not query or publish while the webview is inactive', async () => {
    const setup = createCoordinator({ active: false });

    await setup.coordinator.refresh();

    assert.deepEqual(setup.postedMessages, []);
  });
});
