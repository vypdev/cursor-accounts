import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { RequestLogger } from '../proxy/requestLogger';

describe('RequestLogger', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-logger-')
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes JSON lines log entries', async () => {
    const logger = new RequestLogger(tempDir, 1024 * 1024);
    await logger.initialize();
    logger.log({
      timestamp: new Date().toISOString(),
      direction: 'request',
      url: 'https://api2.cursor.sh/test',
      host: 'api2.cursor.sh',
      headers: { 'content-type': 'application/json' },
    });
    await logger.close();

    const files = await fs.readdir(tempDir);
    assert.ok(files.some((f) => f.endsWith('.jsonl')));
    const content = await fs.readFile(
      path.join(tempDir, files.find((f) => f.endsWith('.jsonl'))!),
      'utf8'
    );
    const line = JSON.parse(content.trim());
    assert.equal(line.direction, 'request');
    assert.equal(line.host, 'api2.cursor.sh');
  });

  it('spills large bodies when spill is enabled', async () => {
    const logger = new RequestLogger(tempDir, 1024 * 1024, {
      maxBodyLogBytes: 4096,
      spillLargeBodies: true,
    });
    await logger.initialize();
    const large = Buffer.alloc(20_000, 0x01);
    const formatted = logger.formatBody(large, 'application/proto', 'big-body');
    assert.ok(formatted.bodyFile);
    assert.equal(formatted.bodyTruncated, undefined);
  });

  it('encodes binary proto bodies as base64', () => {
    const logger = new RequestLogger(tempDir, 1024 * 1024);
    const formatted = logger.formatBody(
      Buffer.from([0, 1, 2, 255]),
      'application/proto'
    );
    assert.equal(formatted.bodyEncoding, 'base64');
    assert.ok(formatted.bodyBase64);
  });

  it('detects Connect-RPC content type', () => {
    assert.equal(
      RequestLogger.isConnectRpcContentType('application/connect+proto'),
      true
    );
    assert.equal(
      RequestLogger.isConnectRpcContentType('application/proto'),
      true
    );
    assert.equal(RequestLogger.isConnectRpcContentType('application/json'), false);
  });

  it('detects Cursor hosts', () => {
    assert.equal(RequestLogger.isCursorHost('api2.cursor.sh'), true);
    assert.equal(RequestLogger.isCursorHost('cursor.com'), true);
    assert.equal(RequestLogger.isCursorHost('example.com'), false);
  });
});
