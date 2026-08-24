import assert from 'node:assert/strict';
import * as net from 'net';
import { describe, it } from 'node:test';
import type { Profile } from '@cursor-accounts/types';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';

function profile(id: string, userDataDir: string): Profile {
  return {
    id,
    email: `${id}@example.com`,
    slug: id,
    displayName: id,
    userDataDir,
    created: '2024-01-01T00:00:00.000Z',
  };
}

describe('ProxyManager per-profile orchestration', () => {
  it('getAllUsedPorts delegates to profile state scan', async () => {
    const dirA = '/tmp/profile-a';
    const dirB = '/tmp/profile-b';
    const profiles = [profile('a', dirA), profile('b', dirB)];
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    const livePort = typeof address === 'object' && address ? address.port : 0;
    assert.ok(livePort > 0);
    const states = new Map<string, Awaited<ReturnType<IProxyStateStore['read']>>>([
      [
        dirA,
        {
          version: 1,
          profileId: 'a',
          running: true,
          port: livePort,
          pid: process.pid,
          lastUpdatedAt: new Date().toISOString(),
        },
      ],
      [
        dirB,
        {
          version: 1,
          profileId: 'b',
          running: false,
          port: 8081,
          lastUpdatedAt: new Date().toISOString(),
        },
      ],
    ]);

    const stateStore: IProxyStateStore = {
      read: async (userDataDir) => states.get(userDataDir) ?? null,
      write: async () => undefined,
      clear: async () => undefined,
    };

    const profileManager: IProfileManager = {
      getProfile: async (id) => profiles.find((p) => p.id === id) ?? null,
      getProfiles: async () => profiles,
    } as IProfileManager;

    try {
      const { getAllUsedProxyPorts } = await import('../proxy/resolvePortForProfile.js');
      const used = await getAllUsedProxyPorts(profileManager, stateStore);
      assert.deepEqual(used, [livePort]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
