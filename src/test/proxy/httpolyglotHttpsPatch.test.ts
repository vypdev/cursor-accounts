import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Proxy } from 'http-mitm-proxy';
import { applyHttpolyglotHttpsPatch } from '../../proxy/httpolyglotHttpsPatch';
import { DEFAULT_ALPN_PROTOCOLS } from '../../domain/types/httpProtocol';

describe('applyHttpolyglotHttpsPatch', () => {
  it('replaces _createHttpsServer on the proxy instance', () => {
    const proxy = new Proxy();
    const original = (proxy as { _createHttpsServer?: unknown })._createHttpsServer;
    assert.equal(typeof original, 'function');

    applyHttpolyglotHttpsPatch(proxy);
    const patched = (proxy as { _createHttpsServer?: unknown })._createHttpsServer;
    assert.notEqual(patched, original);
  });

  it('uses ALPN protocols h2 and HTTP/1.x', () => {
    assert.deepEqual([...DEFAULT_ALPN_PROTOCOLS], ['h2', 'http/1.1', 'http/1.0']);
  });
});
