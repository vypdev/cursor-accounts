import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import type { ProxyStateFile } from '@cursor-accounts/types';
import { SharedProxyStateStore } from '../../proxy/sharedProxyStateStore';

describe('SharedProxyStateStore', () => {
  it('writes a private state file and reads it back', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'cursor-shared-state-'));
    const statePath = path.join(directory, 'nested', 'shared.json');
    const store = new SharedProxyStateStore(statePath);
    const state = {
      version: 1,
      profileId: '__shared__',
      running: true,
      port: 8080,
      apiPort: 18080,
      apiToken: 'token',
      pid: 123,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    } satisfies ProxyStateFile;

    await store.write(state);

    assert.deepEqual(await store.read(), state);
    const persisted = await readFile(statePath, 'utf8');
    assert.match(persisted, /"apiToken": "token"/);
  });

  it('returns null for invalid or absent state and clears idempotently', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'cursor-shared-state-'));
    const statePath = path.join(directory, 'shared.json');
    const store = new SharedProxyStateStore(statePath);

    assert.equal(await store.read(), null);
    await store.write({
      version: 1,
      profileId: '__shared__',
      running: true,
      port: 8080,
      lastUpdatedAt: new Date().toISOString(),
    });
    await store.clear();
    await store.clear();
    assert.equal(await store.read(), null);
  });
});
