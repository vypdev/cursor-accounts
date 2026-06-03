import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import * as installModule from '../proxy/installCaCertificate';

describe('ProxyManager certificate cache', () => {
  it('checkCertificateInstalled caches verify result', async () => {
    const verifyMock = mock.method(
      installModule,
      'verifyCaCertificateInstalled',
      async () => true
    );

    const { ProxyManager } = await import('../services/proxyManager.js');

    const manager = new ProxyManager(
      {
        read: async () => null,
        write: async () => undefined,
        clear: async () => undefined,
      },
      {
        globalStorageUri: { fsPath: '/tmp/cursor-accounts-test' },
        extensionPath: '/tmp/extension',
      } as never
    );

    assert.equal(manager.getCachedCertificateInstalled(), undefined);

    const first = await manager.checkCertificateInstalled();
    const second = await manager.checkCertificateInstalled();

    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(manager.getCachedCertificateInstalled(), true);
    assert.equal(verifyMock.mock.callCount(), 2);

    verifyMock.mock.restore();
  });
});
