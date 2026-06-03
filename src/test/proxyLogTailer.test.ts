import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ProxyLogTailer } from '../proxy/proxyLogTailer';
import type { ProxyLogEntry } from '../proxy/types';

function entry(overrides: Partial<ProxyLogEntry> = {}): ProxyLogEntry {
  return {
    timestamp: new Date().toISOString(),
    direction: 'request',
    method: 'GET',
    url: 'https://api2.cursor.sh/test',
    host: 'api2.cursor.sh',
    headers: { 'content-type': 'application/json', 'user-agent': 'connect-es/1.6.1' },
    isCursorHost: true,
    ...overrides,
  };
}

describe('ProxyLogTailer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-tail-')
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('emits traffic summaries for new JSONL lines', async () => {
    const logPath = path.join(tempDir, 'proxy-2026-06-03-1.jsonl');
    await fs.writeFile(logPath, '', 'utf8');

    const traffic: string[] = [];
    const tailer = new ProxyLogTailer(tempDir, {
      onTraffic: (summary) => {
        traffic.push(`${summary.kind}:${summary.host}:${summary.method ?? ''}`);
      },
    }, { pollIntervalMs: 50 });

    await tailer.start();
    await fs.appendFile(logPath, `${JSON.stringify(entry())}\n`, 'utf8');

    await waitFor(() => traffic.length >= 1, 2000);
    tailer.stop();

    assert.equal(traffic[0], 'request:api2.cursor.sh:GET');
  });

  it('ignores invalid JSON lines', async () => {
    const logPath = path.join(tempDir, 'proxy-2026-06-03-2.jsonl');
    await fs.writeFile(logPath, 'not-json\n', 'utf8');

    const traffic: string[] = [];
    const tailer = new ProxyLogTailer(tempDir, {
      onTraffic: (summary) => {
        traffic.push(summary.kind);
      },
    }, { pollIntervalMs: 50 });

    await tailer.start();
    await fs.appendFile(logPath, `${JSON.stringify(entry({ method: 'POST' }))}\n`, 'utf8');

    await waitFor(() => traffic.length >= 1, 2000);
    tailer.stop();

    assert.deepEqual(traffic, ['request']);
  });

  it('switches to a newer log file on rotation', async () => {
    const oldPath = path.join(tempDir, 'proxy-2026-06-03-old.jsonl');
    const newPath = path.join(tempDir, 'proxy-2026-06-03-new.jsonl');
    await fs.writeFile(oldPath, `${JSON.stringify(entry({ method: 'GET' }))}\n`, 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(newPath, '', 'utf8');

    const traffic: string[] = [];
    const resolved: string[] = [];
    const tailer = new ProxyLogTailer(tempDir, {
      onTraffic: (summary) => {
        traffic.push(summary.method ?? '');
      },
      onLogFileResolved: (filePath) => {
        if (filePath) {
          resolved.push(path.basename(filePath));
        }
      },
    }, { pollIntervalMs: 50 });

    await tailer.start();
    await fs.appendFile(
      newPath,
      `${JSON.stringify(entry({ method: 'PUT' }))}\n`,
      'utf8'
    );

    await waitFor(() => traffic.includes('PUT'), 2000);
    tailer.stop();

    assert.ok(resolved.some((name) => name.includes('new')));
    assert.ok(traffic.includes('PUT'));
    assert.equal(traffic.includes('GET'), false);
  });

  it('replays recent lines when tailFromStart is enabled', async () => {
    const logPath = path.join(tempDir, 'proxy-2026-06-03-replay.jsonl');
    await fs.writeFile(
      logPath,
      `${JSON.stringify(entry({ method: 'PATCH' }))}\n`,
      'utf8'
    );

    const traffic: string[] = [];
    const tailer = new ProxyLogTailer(tempDir, {
      onTraffic: (summary) => {
        traffic.push(summary.method ?? '');
      },
    }, { pollIntervalMs: 50, tailFromStart: true });

    await tailer.start();
    await waitFor(() => traffic.includes('PATCH'), 2000);
    tailer.stop();

    assert.ok(traffic.includes('PATCH'));
  });

  it('emits error summaries', async () => {
    const logPath = path.join(tempDir, 'proxy-2026-06-03-err.jsonl');
    await fs.writeFile(logPath, '', 'utf8');

    const errors: string[] = [];
    const tailer = new ProxyLogTailer(tempDir, {
      onTraffic: () => undefined,
      onError: (summary) => {
        errors.push(summary.errorKind ?? '');
      },
    }, { pollIntervalMs: 50 });

    await tailer.start();
    await fs.appendFile(
      logPath,
      `${JSON.stringify(
        entry({
          direction: 'error',
          errorKind: 'ECONNRESET',
          errorMessage: 'connection reset',
        })
      )}\n`,
      'utf8'
    );

    await waitFor(() => errors.length >= 1, 2000);
    tailer.stop();

    assert.equal(errors[0], 'ECONNRESET');
  });
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}
