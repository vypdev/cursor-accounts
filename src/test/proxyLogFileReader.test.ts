import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  findProxyLogFiles,
  listProxyLogFiles,
  readProxyLogFile,
} from '../proxy/proxyLogFileReader';

describe('proxyLogFileReader', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-accounts-log-reader-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('finds proxy files in deterministic mtime order', async () => {
    const older = path.join(tempDir, 'proxy-older.jsonl');
    const newer = path.join(tempDir, 'proxy-newer.jsonl');
    await fs.writeFile(older, '', 'utf8');
    await fs.writeFile(newer, '', 'utf8');
    await fs.utimes(older, 1_000, 1_000);
    await fs.utimes(newer, 2_000, 2_000);
    await fs.writeFile(path.join(tempDir, 'ignored.log'), '', 'utf8');

    const files = await findProxyLogFiles(tempDir);

    assert.deepEqual(files.map((file) => file.filePath), [older, newer]);
    assert.deepEqual(await listProxyLogFiles(tempDir), [older, newer]);
  });

  it('reads from an offset and reports unchanged files', async () => {
    const filePath = path.join(tempDir, 'proxy-read.jsonl');
    await fs.writeFile(filePath, 'first\nsecond\n', 'utf8');

    const firstRead = await readProxyLogFile(filePath, 0);
    assert.equal(firstRead.kind, 'data');
    if (firstRead.kind !== 'data') {
      return;
    }
    assert.equal(firstRead.chunk, 'first\nsecond\n');

    const unchanged = await readProxyLogFile(filePath, firstRead.nextOffset);
    assert.deepEqual(unchanged, { kind: 'unchanged', truncated: false });
  });

  it('restarts from zero after truncation and handles missing files', async () => {
    const filePath = path.join(tempDir, 'proxy-truncated.jsonl');
    await fs.writeFile(filePath, 'first\nsecond\n', 'utf8');
    const originalSize = (await fs.stat(filePath)).size;
    await fs.truncate(filePath, 2);

    const truncated = await readProxyLogFile(filePath, originalSize);
    assert.deepEqual(truncated, {
      kind: 'data',
      chunk: 'fi',
      nextOffset: 2,
      truncated: true,
    });
    assert.deepEqual(
      await readProxyLogFile(path.join(tempDir, 'missing.jsonl'), 0),
      { kind: 'missing' }
    );
  });
});
