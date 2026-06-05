import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'http';
import { Http2ProtocolAdapter } from '../../proxy/adapters/http2ProtocolAdapter';
import { Http11ProtocolAdapter } from '../../proxy/adapters/http1xProtocolAdapter';
import {
  detectHttpProtocolVersion,
  isHttp2Request,
  resolveProtocolAdapter,
} from '../../proxy/protocolDetection';

describe('protocolDetection', () => {
  it('detects HTTP/1.1 from httpVersion', () => {
    const req = { httpVersion: '1.1', headers: {}, url: '/x' } as IncomingMessage;
    assert.equal(isHttp2Request(req), false);
    assert.equal(detectHttpProtocolVersion(req), 'HTTP/1.1');
    assert.ok(resolveProtocolAdapter(req) instanceof Http11ProtocolAdapter);
  });

  it('detects HTTP/1.0 from httpVersion', () => {
    const req = { httpVersion: '1.0', headers: {}, url: '/poll' } as IncomingMessage;
    assert.equal(detectHttpProtocolVersion(req), 'HTTP/1.0');
  });

  it('detects HTTP/2 from httpVersion 2.0', () => {
    const req = {
      httpVersion: '2.0',
      headers: { ':method': 'POST', ':path': '/RunSSE', ':authority': 'api2.cursor.sh' },
      url: '/RunSSE',
    } as unknown as IncomingMessage;
    assert.equal(isHttp2Request(req), true);
    assert.equal(detectHttpProtocolVersion(req), 'HTTP/2');
    assert.ok(resolveProtocolAdapter(req) instanceof Http2ProtocolAdapter);
  });
});
