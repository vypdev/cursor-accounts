import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CONNECT_RPC_CONTENT_TYPE,
  CURSOR_HOST_SUFFIXES,
  DEFAULT_MAX_BODY_LOG_BYTES,
  DEFAULT_PROXY_PORT,
  PROXY_PORT_FALLBACKS,
  PROXY_STATE_FILE_NAME,
  PROXY_STATE_SCHEMA_VERSION,
  SHARED_PROXY_RUNTIME_KEY,
  SHARED_PROXY_STATE_FILE_NAME,
} from '../../proxy/types';

describe('proxy types and constants', () => {
  it('keeps the runtime and persistence defaults explicit', () => {
    assert.equal(DEFAULT_PROXY_PORT, 8080);
    assert.deepEqual(PROXY_PORT_FALLBACKS, [8080, 8081, 8082, 8888]);
    assert.equal(SHARED_PROXY_RUNTIME_KEY, 'shared');
    assert.equal(PROXY_STATE_FILE_NAME, 'proxy-state.json');
    assert.equal(SHARED_PROXY_STATE_FILE_NAME, 'shared-proxy-state.json');
    assert.equal(PROXY_STATE_SCHEMA_VERSION, 1);
  });

  it('keeps capture protocol and size defaults stable', () => {
    assert.equal(CONNECT_RPC_CONTENT_TYPE, 'application/connect+proto');
    assert.equal(DEFAULT_MAX_BODY_LOG_BYTES, 4 * 1024 * 1024);
    assert.deepEqual(CURSOR_HOST_SUFFIXES, [
      'cursor.sh',
      'cursor.com',
      'cursorapi.com',
    ]);
  });
});
