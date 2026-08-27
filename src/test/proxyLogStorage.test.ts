import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ProxyLogStorage } from '../proxy/proxyLogStorage';

describe('ProxyLogStorage', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-log-storage-')
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('serializes appended JSONL lines and closes the stream', async () => {
    const storage = new ProxyLogStorage(tempDir, 1024 * 1024);
    await storage.initialize();
    storage.append('{"sequence":1}\n');
    storage.append('{"sequence":2}\n');
    await storage.close();

    const files = (await fs.readdir(tempDir)).filter((file) =>
      file.endsWith('.jsonl')
    );
    const [logFile] = files;
    assert.ok(logFile);
    assert.equal(files.length, 1);
    assert.deepEqual(
      (await fs.readFile(path.join(tempDir, logFile), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as unknown),
      [{ sequence: 1 }, { sequence: 2 }]
    );
  });

  it('removes the oldest JSONL files first when the storage cap is exceeded', async () => {
    const oldLog = path.join(tempDir, 'proxy-old.jsonl');
    const newLog = path.join(tempDir, 'proxy-new.jsonl');
    await fs.writeFile(oldLog, 'oldlog');
    await fs.writeFile(newLog, 'newlog');
    const oldTime = new Date('2020-01-01T00:00:00.000Z');
    const newTime = new Date('2020-01-02T00:00:00.000Z');
    await fs.utimes(oldLog, oldTime, oldTime);
    await fs.utimes(newLog, newTime, newTime);

    const storage = new ProxyLogStorage(tempDir, 6);
    await storage.initialize();
    await storage.close();

    assert.equal(await fs.stat(oldLog).then(() => true, () => false), false);
    assert.equal(await fs.readFile(newLog, 'utf8'), 'newlog');
  });

  it('prunes the oldest spilled body when body storage alone exceeds the cap', async () => {
    const bodiesDir = path.join(tempDir, 'bodies');
    await fs.mkdir(bodiesDir);
    const oldBody = path.join(bodiesDir, 'old.bin');
    const newBody = path.join(bodiesDir, 'new.bin');
    await fs.writeFile(oldBody, 'old-body');
    await fs.writeFile(newBody, 'new-body');
    const oldTime = new Date('2020-01-01T00:00:00.000Z');
    const newTime = new Date('2020-01-02T00:00:00.000Z');
    await fs.utimes(oldBody, oldTime, oldTime);
    await fs.utimes(newBody, newTime, newTime);

    const storage = new ProxyLogStorage(tempDir, 8);
    await storage.initialize();
    await storage.close();

    assert.equal(await fs.stat(oldBody).then(() => true, () => false), false);
    assert.equal(await fs.readFile(newBody, 'utf8'), 'new-body');
  });
});
