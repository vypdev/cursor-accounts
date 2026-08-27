import './registerVscodeMock';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Profile, ProxyStateFile } from '@cursor-accounts/types';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type {
  IProxyCertificateOperations,
  ProxyCertificateOperationResult,
} from '../domain/ports/IProxyCertificateOperations';
import type { IProxyCertificateService } from '../domain/ports/IProxyCertificateService';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import { initL10nForTests } from '../l10n';
import { ProxyCertificateMaterialService } from '../services/proxyCertificateMaterialService';
import {
  createProxyCertificateService,
  formatProxyCertificateError,
} from '../services/proxyCertificateService';
import { ProxyCertificateTrustService } from '../services/proxyCertificateTrustService';

const PROFILE: Profile = {
  id: 'profile-1',
  email: 'profile@example.com',
  slug: 'profile',
  displayName: 'Profile',
  userDataDir: '/tmp/profile',
  created: '2026-01-01T00:00:00.000Z',
};

const STATE: ProxyStateFile = {
  version: 1,
  profileId: PROFILE.id,
  running: false,
  lastUpdatedAt: '2026-01-01T00:00:00.000Z',
};

function createOperations(
  overrides: Partial<IProxyCertificateOperations> = {}
): IProxyCertificateOperations {
  return {
    ensureCaCertificate: async () => '/tmp/generated-ca.pem',
    certificatePathExists: async () => false,
    checkInstalled: async () => false,
    install: async () => ({ success: true }),
    uninstall: async () => ({ success: true }),
    ...overrides,
  };
}

function createService(options: {
  operations?: IProxyCertificateOperations;
  profiles?: Profile[];
  states?: Record<string, ProxyStateFile | null>;
} = {}): IProxyCertificateService {
  const states = options.states ?? {};
  const stateStore: IProxyStateStore = {
    read: async (userDataDir) => states[userDataDir] ?? null,
    write: async () => undefined,
    clear: async () => undefined,
  };
  const profileManager: IProfileReader = {
    getProfiles: async () => options.profiles ?? [PROFILE],
    getProfile: async () => undefined,
    findProfileByEmail: async () => undefined,
    findProfileByPath: async () => undefined,
  };

  const operations = options.operations ?? createOperations();
  const material = new ProxyCertificateMaterialService(
    operations,
    stateStore,
    profileManager
  );
  return createProxyCertificateService(
    material,
    new ProxyCertificateTrustService(operations, material)
  );
}

function result(
  success: boolean,
  error?: string
): ProxyCertificateOperationResult {
  return error === undefined ? { success } : { success, error };
}

describe('ProxyCertificateService', () => {
  initL10nForTests({});

  it('resolves an existing persisted certificate and builds its install guide', async () => {
    const persistedPath = '/tmp/persisted-ca.pem';
    const operations = createOperations({
      certificatePathExists: async (certificatePath) =>
        certificatePath === persistedPath,
    });
    const service = createService({
      operations,
      states: {
        [PROFILE.userDataDir]: { ...STATE, caCertificatePath: persistedPath },
      },
    });

    assert.equal(await service.getCertificatePath(), persistedPath);
    const guide = await service.getInstallGuide();
    assert.equal(guide.certAvailable, true);
    assert.equal(await service.ensureCaCertificate(), '/tmp/generated-ca.pem');
  });

  it('falls back to generation when persisted paths are unavailable', async () => {
    const ensureCaCertificate = async () => '/tmp/fallback-ca.pem';
    const service = createService({
      operations: createOperations({ ensureCaCertificate }),
      profiles: [
        PROFILE,
        { ...PROFILE, id: 'profile-2', userDataDir: '/tmp/profile-2' },
      ],
      states: {
        [PROFILE.userDataDir]: { ...STATE, caCertificatePath: '/tmp/missing.pem' },
      },
    });

    assert.equal(await service.getCertificatePath(), '/tmp/fallback-ca.pem');

    const pathCheckFailure = createService({
      operations: createOperations({
        certificatePathExists: () => Promise.reject(new Error('path check failed')),
        ensureCaCertificate: async () => '/tmp/path-check-fallback.pem',
      }),
      states: {
        [PROFILE.userDataDir]: { ...STATE, caCertificatePath: '/tmp/unknown.pem' },
      },
    });
    assert.equal(await pathCheckFailure.getCertificatePath(), '/tmp/path-check-fallback.pem');

    const unavailableService = createService({
      operations: createOperations({
        ensureCaCertificate: async () => {
          throw new Error('certificate generation failed');
        },
      }),
    });
    assert.equal(await unavailableService.getCertificatePath(), null);
  });

  it('caches installed status after explicit checks', async () => {
    let installed = true;
    const service = createService({
      operations: createOperations({
        checkInstalled: async () => installed,
      }),
    });

    assert.equal(service.getCachedInstalled(), undefined);
    assert.equal(await service.checkInstalled(), true);
    assert.equal(service.getCachedInstalled(), true);
    installed = false;
    assert.equal(await service.checkInstalled(), false);
    assert.equal(service.getCachedInstalled(), false);
  });

  it('normalizes both Error and unknown certificate operation failures', () => {
    assert.equal(formatProxyCertificateError(new Error('native failure')), 'native failure');
    assert.equal(formatProxyCertificateError('unknown failure'), 'unknown failure');
  });

  it('installs when needed and accepts verification after an ambiguous failure', async () => {
    let checks = 0;
    const install = async () => result(false, 'permission denied');
    const service = createService({
      operations: createOperations({
        certificatePathExists: async () => true,
        checkInstalled: async () => {
          checks += 1;
          return checks > 1;
        },
        install,
      }),
      states: {
        [PROFILE.userDataDir]: { ...STATE, caCertificatePath: '/tmp/ca.pem' },
      },
    });

    assert.deepEqual(await service.install(), { success: true });
    assert.equal(service.getCachedInstalled(), true);
  });

  it('returns unavailable and failed installation results without hiding errors', async () => {
    const unavailable = createService({
      operations: createOperations({
        ensureCaCertificate: async () => {
          throw new Error('cannot generate');
        },
      }),
    });
    assert.deepEqual(await unavailable.install(), {
      success: false,
      error: 'CA certificate is not available. Start the proxy once to generate it.',
    });

    const failedInstall = createService({
      operations: createOperations({
        certificatePathExists: async () => true,
        checkInstalled: async () => false,
        install: async () => result(false, 'permission denied'),
      }),
      states: {
        [PROFILE.userDataDir]: { ...STATE, caCertificatePath: '/tmp/ca.pem' },
      },
    });
    assert.deepEqual(await failedInstall.install(), {
      success: false,
      error: 'permission denied',
    });

    const alreadyInstalled = createService({
      operations: createOperations({
        certificatePathExists: async () => true,
        checkInstalled: async () => true,
        install: async () => {
          throw new Error('must not install');
        },
      }),
      states: {
        [PROFILE.userDataDir]: { ...STATE, caCertificatePath: '/tmp/ca.pem' },
      },
    });
    assert.deepEqual(await alreadyInstalled.install(), { success: true });
  });

  it('handles install and uninstall exceptions at the service boundary', async () => {
    const installFailure = createService({
      operations: createOperations({
        ensureCaCertificate: () => Promise.reject(new Error('generation failed')),
      }),
    });
    assert.deepEqual(await installFailure.install(), {
      success: false,
      error: 'CA certificate is not available. Start the proxy once to generate it.',
    });

    const nativeInstallFailure = createService({
      operations: createOperations({
        certificatePathExists: async () => true,
        checkInstalled: async () => false,
        install: async () => {
          throw new Error('native installer failed');
        },
      }),
      states: {
        [PROFILE.userDataDir]: { ...STATE, caCertificatePath: '/tmp/ca.pem' },
      },
    });
    assert.deepEqual(await nativeInstallFailure.install(), {
      success: false,
      error: 'native installer failed',
    });

    const uninstallFailure = createService({
      operations: createOperations({
        uninstall: () => Promise.reject(new Error('uninstall failed')),
      }),
    });
    assert.deepEqual(await uninstallFailure.uninstall(), {
      success: false,
      error: 'uninstall failed',
    });
  });

  it('updates cache on uninstall and treats an already-removed certificate as success', async () => {
    const successful = createService({
      operations: createOperations({
        checkInstalled: async () => true,
        uninstall: async () => result(true),
      }),
    });
    await successful.checkInstalled();
    assert.deepEqual(await successful.uninstall(), { success: true });
    assert.equal(successful.getCachedInstalled(), false);

    const alreadyRemoved = createService({
      operations: createOperations({
        checkInstalled: async () => false,
        uninstall: async () => result(false, 'not found'),
      }),
    });
    assert.deepEqual(await alreadyRemoved.uninstall(), { success: true });

    const stillInstalled = createService({
      operations: createOperations({
        checkInstalled: async () => true,
        uninstall: async () => result(false, 'permission denied'),
      }),
    });
    assert.deepEqual(await stillInstalled.uninstall(), {
      success: false,
      error: 'permission denied',
    });
  });
});
