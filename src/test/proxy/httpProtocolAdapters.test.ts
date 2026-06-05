import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'http';
import { Http2ProtocolAdapter } from '../../proxy/adapters/http2ProtocolAdapter';
import {
  Http10ProtocolAdapter,
  Http11ProtocolAdapter,
  createHttp1xProtocolAdapter,
} from '../../proxy/adapters/http1xProtocolAdapter';

describe('Http2ProtocolAdapter', () => {
  it('maps pseudo-headers to url and host', () => {
    const adapter = new Http2ProtocolAdapter();
    const info = adapter.buildRequestInfo({
      httpVersion: '2.0',
      headers: {
        ':method': 'POST',
        ':path': '/agent.v1.AgentService/RunSSE',
        ':authority': 'agent.api5.cursor.sh',
        ':scheme': 'https',
      },
      url: '/agent.v1.AgentService/RunSSE',
    } as unknown as IncomingMessage);

    assert.equal(info.protocol, 'HTTP/2');
    assert.equal(info.method, 'POST');
    assert.equal(info.host, 'agent.api5.cursor.sh');
    assert.ok(info.url.includes('agent.api5.cursor.sh'));
    assert.ok(info.url.includes('RunSSE'));
  });
});

describe('Http11ProtocolAdapter', () => {
  it('builds http url for plain socket', () => {
    const adapter = new Http11ProtocolAdapter();
    const info = adapter.buildRequestInfo({
      httpVersion: '1.1',
      method: 'POST',
      url: '/BidiAppend',
      headers: { host: 'api2.cursor.sh' },
      socket: { encrypted: false },
    } as unknown as IncomingMessage);

    assert.equal(info.protocol, 'HTTP/1.1');
    assert.equal(info.url, 'http://api2.cursor.sh/BidiAppend');
  });
});

describe('createHttp1xProtocolAdapter', () => {
  it('selects HTTP/1.0 adapter for httpVersion 1.0', () => {
    const adapter = createHttp1xProtocolAdapter({
      httpVersion: '1.0',
      headers: {},
      url: '/',
    } as IncomingMessage);
    assert.ok(adapter instanceof Http10ProtocolAdapter);
  });

  it('selects HTTP/1.1 adapter for httpVersion 1.1', () => {
    const adapter = createHttp1xProtocolAdapter({
      httpVersion: '1.1',
      headers: {},
      url: '/',
    } as IncomingMessage);
    assert.ok(adapter instanceof Http11ProtocolAdapter);
  });
});

describe('Http2ProtocolAdapter edge cases', () => {
  it('falls back to host header when :authority is missing', () => {
    const adapter = new Http2ProtocolAdapter();
    const info = adapter.buildRequestInfo({
      httpVersion: '2.0',
      headers: {
        ':method': 'POST',
        ':path': '/RunSSE',
        host: 'api2.cursor.sh',
      },
      url: '/RunSSE',
    } as unknown as IncomingMessage);

    assert.equal(info.host, 'api2.cursor.sh');
    assert.ok(info.url.includes('api2.cursor.sh'));
  });
});

describe('Http10ProtocolAdapter', () => {
  it('builds https url for encrypted socket', () => {
    const adapter = new Http10ProtocolAdapter();
    const info = adapter.buildRequestInfo({
      httpVersion: '1.0',
      method: 'POST',
      url: '/RunPoll',
      headers: { host: 'api2.cursor.sh' },
      socket: { encrypted: true },
    } as unknown as IncomingMessage);

    assert.equal(info.protocol, 'HTTP/1.0');
    assert.equal(info.url, 'https://api2.cursor.sh/RunPoll');
  });
});
