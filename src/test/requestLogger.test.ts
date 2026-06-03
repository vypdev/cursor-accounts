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

  it('truncates large bodies', () => {
    const large = 'x'.repeat(20_000);
    const formatted = RequestLogger.formatBody(large);
    assert.equal(formatted.bodyTruncated, true);
    assert.ok((formatted.body?.length ?? 0) <= 10_240);
  });

  it('detects Connect-RPC content type', () => {
    assert.equal(
      RequestLogger.isConnectRpcContentType('application/connect+proto'),
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
