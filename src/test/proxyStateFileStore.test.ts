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
    store = new ProxyStateFileStore();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns null when state file is missing', async () => {
    assert.equal(await store.read(tempDir), null);
  });

  it('writes and reads proxy state atomically in userDataDir', async () => {
    const state = {
      version: 1,
      profileId: 'profile-a',
      running: true,
      port: 8080,
      pid: 12345,
      startedAt: new Date().toISOString(),
      caCertificatePath: '/tmp/ca.pem',
      lastUpdatedAt: new Date().toISOString(),
    };

    await store.write(tempDir, state);
    const read = await store.read(tempDir);
    assert.deepEqual(read, state);
    assert.equal(store.getStatePath(tempDir), path.join(tempDir, 'proxy-state.json'));

    const fileStats = await fs.stat(store.getStatePath(tempDir));
    assert.equal(fileStats.mode & 0o777, 0o600);
  });

  it('supports concurrent writes without colliding temporary files', async () => {
    const states = [
      {
        version: 1,
        profileId: 'profile-a',
        running: true,
        port: 8080,
        lastUpdatedAt: '2026-08-27T00:00:00.000Z',
      },
      {
        version: 1,
        profileId: 'profile-a',
        running: false,
        apiPort: 18_080,
        lastUpdatedAt: '2026-08-27T00:00:01.000Z',
      },
    ];

    await Promise.all(states.map((state) => store.write(tempDir, state)));

    const read = await store.read(tempDir);
    assert.ok(read);
    assert.equal(read.profileId, 'profile-a');
    assert.deepEqual(await fs.readdir(tempDir), ['proxy-state.json']);
  });

  it('returns null for corrupted JSON', async () => {
    const statePath = store.getStatePath(tempDir);
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(statePath, '{not json', 'utf8');
    assert.equal(await store.read(tempDir), null);
  });

  it('clears state file', async () => {
    await store.write(tempDir, {
      version: 1,
      profileId: 'profile-a',
      running: true,
      lastUpdatedAt: new Date().toISOString(),
    });
    await store.clear(tempDir);
    assert.equal(await store.read(tempDir), null);
  });
});
