import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ProxyLogEntryProcessor } from '../proxy/proxyLogEntryProcessor';
import type { ProxyLogEntry } from '../proxy/types';

function entry(overrides: Partial<ProxyLogEntry> = {}): ProxyLogEntry {
  return {
    timestamp: new Date().toISOString(),
    direction: 'request',
    method: 'GET',
    url: 'https://api2.cursor.sh/test',
    host: 'api2.cursor.sh',
    headers: { 'content-type': 'application/json' },
    isCursorHost: true,
    ...overrides,
  };
}

describe('ProxyLogEntryProcessor', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-accounts-log-processor-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('processes partial lines and calculates response duration', async () => {
    const traffic: Array<{ method?: string; durationMs?: number }> = [];
    const processor = new ProxyLogEntryProcessor(tempDir, {
      onTraffic: (summary) => traffic.push(summary),
    });
    const startedAt = new Date('2026-06-03T10:00:00.000Z');
    const request = entry({
      requestId: 'request-1',
      timestamp: startedAt.toISOString(),
    });
    const response = entry({
      direction: 'response',
      requestId: 'request-1',
      timestamp: new Date(startedAt.getTime() + 250).toISOString(),
    });

    processor.processChunk(JSON.stringify(request), () => true);
    processor.processChunk(`\n${JSON.stringify(response)}\n`, () => true);

    await waitFor(() => traffic.length === 2, 2000);
    assert.equal(traffic[0]?.method, 'GET');
    assert.equal(traffic[1]?.durationMs, 250);
  });

  it('emits error entries and ignores malformed lines', () => {
    const errors: string[] = [];
    const traffic: string[] = [];
    const processor = new ProxyLogEntryProcessor(tempDir, {
      onTraffic: (summary) => traffic.push(summary.kind),
      onError: (summary) => errors.push(summary.errorKind ?? ''),
    });

    processor.processChunk(
      `invalid\n${JSON.stringify(entry({
        direction: 'error',
        errorKind: 'ECONNRESET',
      }))}\n`,
      () => true
    );

    assert.deepEqual(errors, ['ECONNRESET']);
    assert.deepEqual(traffic, []);
  });

  it('does not publish a pending summary after the lifecycle becomes inactive', async () => {
    const traffic: string[] = [];
    const processor = new ProxyLogEntryProcessor(tempDir, {
      onTraffic: (summary) => traffic.push(summary.kind),
    });
    let active = true;

    processor.processChunk(`${JSON.stringify(entry())}\n`, () => active);
    active = false;
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.deepEqual(traffic, []);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}
