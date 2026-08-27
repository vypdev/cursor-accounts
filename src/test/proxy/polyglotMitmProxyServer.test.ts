import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Proxy } from 'http-mitm-proxy';
import { PolyglotMitmProxyServer } from '../../proxy/polyglotMitmProxyServer';
import { NullLogger } from '../../proxy/nullLogger';
import { CertificateManager } from '../../proxy/certificateManager';
import { MitmCertificateDirectory } from '../../proxy/mitmCertificateDirectory';
import { applyHttpolyglotHttpsPatch } from '../../proxy/httpolyglotHttpsPatch';

describe('PolyglotMitmProxyServer', () => {
  it('createMitmProxy applies httpolyglot HTTPS patch', () => {
    const server = new PolyglotMitmProxyServer(
      new MitmCertificateDirectory(
        '/tmp/unused',
        new CertificateManager('/tmp/unused')
      ),
      new NullLogger()
    );
    const proxy = (
      server as unknown as { createMitmProxy(): Proxy }
    ).createMitmProxy();
    const bare = new Proxy();
    applyHttpolyglotHttpsPatch(bare);
    assert.equal(
      typeof (proxy as { _createHttpsServer?: unknown })._createHttpsServer,
      'function'
    );
    assert.notEqual(
      (proxy as { _createHttpsServer?: unknown })._createHttpsServer,
      (new Proxy() as { _createHttpsServer?: unknown })._createHttpsServer
    );
  });

  it('uses default listen options without forceSNI', () => {
    const server = new PolyglotMitmProxyServer(
      new MitmCertificateDirectory(
        '/tmp/unused',
        new CertificateManager('/tmp/unused')
      ),
      new NullLogger()
    );
    const opts = (
      server as unknown as {
        getMitmListenOptions(sslCaDir: string, port: number): {
          forceSNI?: boolean;
          port: number;
        };
      }
    ).getMitmListenOptions('/ca', 8080);
    assert.equal(opts.forceSNI, undefined);
    assert.equal(opts.port, 8080);
  });
});
