import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { bodyBufferFromLogEntry, captureBodyForLog } from '../proxy/bodyCapture';

describe('bodyCapture', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-body-capture-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('spills large bodies to logDir/bodies instead of truncating', () => {
    const large = Buffer.alloc(50_000, 0xab);
    const formatted = captureBodyForLog(large, 'application/proto', {
      maxInlineBytes: 4096,
      spillLargeBodies: true,
      logDir: tempDir,
      spillKey: 'test-spill',
    });

    assert.equal(formatted.bodyTruncated, undefined);
    assert.ok(formatted.bodyFile?.includes('bodies/test-spill.bin'));
    assert.equal(formatted.bodyRawBytes, 50_000);

    const restored = bodyBufferFromLogEntry(formatted, tempDir);
    assert.ok(restored?.equals(large));
  });

  it('does not allow a spill key to escape the bodies directory', async () => {
    const outsidePath = path.join(
      tempDir,
      '..',
      `${path.basename(tempDir)}-outside.bin`
    );
    const result = captureBodyForLog(Buffer.alloc(20_000, 0x01), 'application/proto', {
      maxInlineBytes: 4096,
      logDir: tempDir,
      spillKey: '../outside',
    });
    assert.equal(result.bodyFile, undefined);
    assert.equal(result.bodyTruncated, true);
    await assert.rejects(fs.access(outsidePath));
  });

  it('keeps small bodies inline as base64', () => {
    const raw = Buffer.from([1, 2, 3]);
    const formatted = captureBodyForLog(raw, 'application/proto', {
      maxInlineBytes: 4096,
      spillLargeBodies: true,
      logDir: tempDir,
    });
    assert.ok(formatted.bodyBase64);
    assert.equal(formatted.bodyFile, undefined);
  });

  it('stores text/event-stream bodies as base64 to preserve Connect frames', () => {
    const raw = Buffer.from([0x00, 0x00, 0x00, 0x04, 0xff, 0xfe, 0xfd]);
    const formatted = captureBodyForLog(raw, 'text/event-stream', {
      maxInlineBytes: 4096,
      spillLargeBodies: true,
      logDir: tempDir,
    });

    assert.ok(formatted.bodyBase64);
    assert.equal(formatted.bodyEncoding, 'base64');
    assert.equal(formatted.body, undefined);

    const restored = bodyBufferFromLogEntry(formatted, tempDir);
    assert.ok(restored?.equals(raw));
  });

  it('rejects absolute and traversal sidecar paths', () => {
    assert.equal(
      bodyBufferFromLogEntry({ bodyFile: '/etc/passwd' }, tempDir),
      null
    );
    assert.equal(
      bodyBufferFromLogEntry({ bodyFile: '../outside.bin' }, tempDir),
      null
    );
  });

  it('redacts credential fields in persisted JSON bodies', () => {
    const formatted = captureBodyForLog(
      JSON.stringify({ access_token: 'secret', usage: { total: 42 } }),
      'application/json',
      { maxInlineBytes: 4096, redactJsonFields: true }
    );
    assert.equal(
      formatted.body,
      JSON.stringify({ access_token: '[REDACTED]', usage: { total: 42 } })
    );
  });
});
