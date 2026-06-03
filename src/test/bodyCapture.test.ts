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
});
