import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProxyCertificateOperationResult } from '../../domain/ports/IProxyCertificateOperations';
import { createProxyCertificateOperations } from '../../proxy/proxyCertificateOperations';

function createCertificateManager(overrides: {
  ensureCaCertificate?: () => Promise<string>;
  installCertificateWithElevation?: () => Promise<ProxyCertificateOperationResult>;
  uninstallCertificate?: () => Promise<ProxyCertificateOperationResult>;
} = {}) {
  return {
    ensureCaCertificate: async () => '/tmp/ca.pem',
    installCertificateWithElevation: async () => ({ success: true }),
    uninstallCertificate: async () => ({ success: true }),
    ...overrides,
  };
}

describe('createProxyCertificateOperations', () => {
  it('delegates certificate generation and trust-store lifecycle operations', async () => {
    const operations = createProxyCertificateOperations(
      createCertificateManager({
        ensureCaCertificate: async () => '/tmp/generated.pem',
        installCertificateWithElevation: async () => ({
          success: false,
          error: 'install failed',
        }),
        uninstallCertificate: async () => ({
          success: false,
          error: 'uninstall failed',
        }),
      }),
      { access: async () => undefined, checkInstalled: async () => true }
    );

    assert.equal(await operations.ensureCaCertificate(), '/tmp/generated.pem');
    assert.deepEqual(await operations.install(), {
      success: false,
      error: 'install failed',
    });
    assert.deepEqual(await operations.uninstall(), {
      success: false,
      error: 'uninstall failed',
    });
    assert.equal(await operations.checkInstalled(), true);
  });

  it('reports available and unavailable certificate paths without leaking access errors', async () => {
    const operations = createProxyCertificateOperations(
      createCertificateManager(),
      {
        access: async (certificatePath) => {
          if (certificatePath === '/tmp/missing.pem') {
            throw new Error('permission denied');
          }
        },
        checkInstalled: async () => false,
      }
    );

    assert.equal(await operations.certificatePathExists('/tmp/ca.pem'), true);
    assert.equal(
      await operations.certificatePathExists('/tmp/missing.pem'),
      false
    );
    assert.equal(await operations.checkInstalled(), false);
  });
});
