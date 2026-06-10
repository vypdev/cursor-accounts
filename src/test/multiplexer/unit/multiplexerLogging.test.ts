import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { formatMultiplexerLogLine } from '../../../proxy/multiplexer/formatMultiplexerLogLine';
import {
  listMultiplexerLogFiles,
  MultiplexerEventLogger,
} from '../../../proxy/multiplexer/multiplexerEventLogger';
import { MultiplexerLogTailer } from '../../../proxy/multiplexer/multiplexerLogTailer';

describe('MultiplexerEventLogger', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-accounts-mux-log-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes lifecycle events as JSONL', async () => {
    const logger = new MultiplexerEventLogger(tempDir);
    await logger.logMultiplexerStarted(9000, 'workspace-path');

    const files = await listMultiplexerLogFiles(tempDir);
    assert.equal(files.length, 1);

    const content = await fs.readFile(files[0]!, 'utf8');
    const entry = JSON.parse(content.trim()) as Record<string, unknown>;
    assert.equal(entry.event, 'multiplexer_started');
    assert.equal(entry.port, 9000);
    assert.equal(entry.strategy, 'workspace-path');
  });

  it('keeps at most 3 log files', async () => {
    for (let index = 0; index < 5; index += 1) {
      const logger = new MultiplexerEventLogger(tempDir);
      await logger.logMultiplexerStarted(9000 + index);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const files = await listMultiplexerLogFiles(tempDir);
    assert.ok(files.length <= 3, `expected <= 3 files, got ${files.length}`);
  });
});

describe('formatMultiplexerLogLine', () => {
  it('formats known events', () => {
    assert.match(
      formatMultiplexerLogLine({
        timestamp: new Date().toISOString(),
        level: 'info',
        component: 'multiplexer',
        event: 'multiplexer_started',
        port: 9000,
        strategy: 'workspace-path',
      }) ?? '',
      /Global multiplexer started on port 9000/
    );
  });
});

describe('MultiplexerLogTailer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-accounts-mux-tail-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('emits formatted lines for new JSONL entries', async () => {
    const logPath = path.join(tempDir, 'router-2026-06-09-1.jsonl');
    await fs.writeFile(logPath, '', 'utf8');

    const lines: string[] = [];
    const tailer = new MultiplexerLogTailer(
      tempDir,
      {
        onLogLine: (line) => lines.push(line),
      },
      { pollIntervalMs: 50, tailFromStart: false }
    );

    await tailer.start();
    await fs.appendFile(
      logPath,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        component: 'multiplexer',
        event: 'multiplexer_started',
        port: 9000,
      })}\n`,
      'utf8'
    );

    await waitFor(() => lines.length >= 1, 2000);
    tailer.stop();

    assert.match(lines[0] ?? '', /Global multiplexer started on port 9000/);
  });
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 25
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
