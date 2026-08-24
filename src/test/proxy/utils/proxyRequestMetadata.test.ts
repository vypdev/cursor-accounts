import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  inferEndpointPath,
  isConnectRpcContentType,
  isCursorHost,
  normalizeHeaders,
  redactHeadersForLog,
} from '../../../proxy/utils/proxyRequestMetadata';

describe('proxyRequestMetadata', () => {
  it('normalizeHeaders joins array values', () => {
    const headers = normalizeHeaders({ 'x-test': ['a', 'b'] });
    assert.equal(headers['x-test'], 'a, b');
  });

  it('isCursorHost matches cursor suffixes', () => {
    assert.equal(isCursorHost('api2.cursor.sh'), true);
    assert.equal(isCursorHost('example.com'), false);
  });

  it('redacts credentials before headers are persisted', () => {
    const headers = redactHeadersForLog({
      authorization: 'Bearer secret',
      cookie: 'session=secret',
      'x-request-id': 'request-1',
    });
    assert.equal(headers.authorization, '[REDACTED]');
    assert.equal(headers.cookie, '[REDACTED]');
    assert.equal(headers['x-request-id'], 'request-1');
  });

  it('isConnectRpcContentType detects connect proto', () => {
    assert.equal(
      isConnectRpcContentType('application/connect+proto'),
      true
    );
    assert.equal(isConnectRpcContentType('text/html'), false);
  });

  it('inferEndpointPath returns pathname', () => {
    assert.equal(
      inferEndpointPath('https://api2.cursor.sh/agent.v1.AgentService/RunSSE', 'api2.cursor.sh'),
      '/agent.v1.AgentService/RunSSE'
    );
  });
});
