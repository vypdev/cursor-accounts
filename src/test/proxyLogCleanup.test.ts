import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { clearProxyLogDirectory } from '../proxy/proxyLogCleanup';

describe('clearProxyLogDirectory', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-accounts-log-'));
    await fs.mkdir(path.join(tempDir, 'bodies'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('deletes proxy logs and body sidecars but preserves unrelated files', async () => {
    await fs.writeFile(path.join(tempDir, 'proxy-2026.jsonl'), '{}\n');
    await fs.writeFile(path.join(tempDir, 'bodies', 'body.bin'), 'secret');
    await fs.writeFile(path.join(tempDir, 'bodies', 'keep.txt'), 'keep');
    await fs.mkdir(path.join(tempDir, 'bodies', 'ignored.bin'));
    await fs.writeFile(path.join(tempDir, 'keep.txt'), 'keep');
    await fs.mkdir(path.join(tempDir, 'bodies', 'nested'));

    const result = await clearProxyLogDirectory(tempDir);

    assert.equal(result.deletedFiles, 2);
    assert.equal((await fs.readdir(tempDir)).includes('keep.txt'), true);
    assert.equal((await fs.readdir(path.join(tempDir, 'bodies'))).includes('body.bin'), false);
    assert.equal((await fs.readdir(path.join(tempDir, 'bodies'))).includes('keep.txt'), true);
    assert.equal((await fs.readdir(path.join(tempDir, 'bodies'))).includes('nested'), true);
    assert.equal((await fs.readdir(path.join(tempDir, 'bodies'))).includes('ignored.bin'), true);
  });

  it('is idempotent when the directory does not exist', async () => {
    const result = await clearProxyLogDirectory(path.join(tempDir, 'missing'));
    assert.deepEqual(result, { deletedFiles: 0, deletedBytes: 0 });
  });

  it('fails closed when the log path is not a directory', async () => {
    const filePath = path.join(tempDir, 'not-a-directory');
    await fs.writeFile(filePath, 'not a directory');
    await assert.rejects(clearProxyLogDirectory(filePath), /ENOTDIR/);
  });

  it('fails closed when the bodies path is not a directory', async () => {
    await fs.rm(path.join(tempDir, 'bodies'), { recursive: true, force: true });
    await fs.writeFile(path.join(tempDir, 'bodies'), 'not a directory');
    await assert.rejects(clearProxyLogDirectory(tempDir), /ENOTDIR/);
  });
});
