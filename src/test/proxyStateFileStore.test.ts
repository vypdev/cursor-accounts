import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ProxyStateFileStore } from '../proxy/proxyStateFileStore';

describe('ProxyStateFileStore', () => {
  let tempDir: string;
  let store: ProxyStateFileStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-proxy-state-')
    );
    store = new ProxyStateFileStore(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns null when state file is missing', async () => {
    assert.equal(await store.read(), null);
  });

  it('writes and reads proxy state atomically', async () => {
    const state = {
      version: 1,
      running: true,
      port: 8080,
      pid: 12345,
      startedAt: new Date().toISOString(),
      caCertificatePath: '/tmp/ca.pem',
      lastUpdatedAt: new Date().toISOString(),
    };

    await store.write(state);
    const read = await store.read();
    assert.deepEqual(read, state);
  });

  it('returns null for corrupted JSON', async () => {
    await fs.writeFile(store.getStatePath(), '{not json', 'utf8');
    assert.equal(await store.read(), null);
  });

  it('clears state file', async () => {
    await store.write({
      version: 1,
      running: true,
      lastUpdatedAt: new Date().toISOString(),
    });
    await store.clear();
    assert.equal(await store.read(), null);
  });
});
