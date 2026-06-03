import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import { captureBodyForLog, bodyBufferFromLogEntry } from '../proxy/bodyCapture';
import { decompressBodyBuffer } from '../proxy/bodyFormat';

describe('bodyFormat', () => {
  it('stores proto bodies as base64', () => {
    const raw = Buffer.from([0x08, 0x96, 0x01, 0xff, 0xfe]);
    const formatted = captureBodyForLog(raw, 'application/proto', {
      spillLargeBodies: false,
      maxInlineBytes: 1024 * 1024,
    });
    assert.equal(formatted.bodyEncoding, 'base64');
    assert.ok(formatted.bodyBase64);
    assert.equal(formatted.bodyRawBytes, 5);
    assert.equal(formatted.body, undefined);
  });

  it('round-trips base64 log entries', () => {
    const raw = Buffer.from('hello-proto', 'utf8');
    const formatted = captureBodyForLog(raw, 'application/connect+proto', {
      spillLargeBodies: false,
      maxInlineBytes: 1024 * 1024,
    });
    const restored = bodyBufferFromLogEntry({
      bodyBase64: formatted.bodyBase64,
      bodyEncoding: 'base64',
    });
    assert.ok(restored);
    assert.equal(restored.toString('utf8'), 'hello-proto');
  });

  it('decompresses gzip bodies', () => {
    const plain = Buffer.from('{"ok":true}');
    const compressed = gzipSync(plain);
    const { body, decompressed } = decompressBodyBuffer(compressed, 'gzip');
    assert.equal(decompressed, true);
    assert.equal(body.toString('utf8'), '{"ok":true}');
  });
});
