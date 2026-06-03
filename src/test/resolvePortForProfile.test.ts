import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import type { Profile } from '@cursor-accounts/types';
import {
  getAllUsedProxyPorts,
  resolvePortForProfile,
} from '../proxy/resolvePortForProfile';
import { isPortAvailable } from '../proxy/portUtils';
import { ProxyStateFileStore } from '../proxy/proxyStateFileStore';

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

function createProfileManager(profiles: Profile[]): IProfileManager {
  return {
    getProfile: async (id: string) => profiles.find((p) => p.id === id) ?? null,
    getProfiles: async () => profiles,
  } as IProfileManager;
}

async function listenOnPort(port: number): Promise<net.Server> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

describe('resolvePortForProfile', () => {
  let tempRoot: string;
  let store: ProxyStateFileStore;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-resolve-port-')
    );
    store = new ProxyStateFileStore();
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('reuses assigned port from profile state when available', async () => {
    const dirA = path.join(tempRoot, 'profile-a');
    await fs.mkdir(dirA, { recursive: true });
    const profiles = [profile('profile-a', dirA)];
    const manager = createProfileManager(profiles);

    let assignedPort = 18080;
    for (let candidate = 18080; candidate < 18100; candidate += 1) {
      if (await isPortAvailable(candidate)) {
        assignedPort = candidate;
        break;
      }
    }

    await store.write(dirA, {
      version: 1,
      profileId: 'profile-a',
      running: false,
      port: assignedPort,
      lastUpdatedAt: new Date().toISOString(),
    });

    const port = await resolvePortForProfile('profile-a', manager, store);
    assert.equal(port, assignedPort);
  });

  it('assigns a different port when another profile already uses 8080', async () => {
    const dirA = path.join(tempRoot, 'profile-a');
    const dirB = path.join(tempRoot, 'profile-b');
    await fs.mkdir(dirA, { recursive: true });
    await fs.mkdir(dirB, { recursive: true });

    const profiles = [profile('profile-a', dirA), profile('profile-b', dirB)];
    const manager = createProfileManager(profiles);

    await store.write(dirA, {
      version: 1,
      profileId: 'profile-a',
      running: false,
      port: 8080,
      lastUpdatedAt: new Date().toISOString(),
    });

    const portB = await resolvePortForProfile('profile-b', manager, store);
    assert.notEqual(portB, 8080);
    assert.ok(portB === 8081 || portB === 8082 || portB === 8888);
  });

  it('getAllUsedProxyPorts returns only live proxy ports', async () => {
    const dirA = path.join(tempRoot, 'profile-a');
    const dirB = path.join(tempRoot, 'profile-b');
    await fs.mkdir(dirA, { recursive: true });
    await fs.mkdir(dirB, { recursive: true });

    const profiles = [profile('profile-a', dirA), profile('profile-b', dirB)];
    const manager = createProfileManager(profiles);

    const server = await listenOnPort(8099);
    try {
      await store.write(dirA, {
        version: 1,
        profileId: 'profile-a',
        running: true,
        port: 8099,
        pid: process.pid,
        lastUpdatedAt: new Date().toISOString(),
      });
      await store.write(dirB, {
        version: 1,
        profileId: 'profile-b',
        running: false,
        port: 8081,
        lastUpdatedAt: new Date().toISOString(),
      });

      const used = await getAllUsedProxyPorts(manager, store);
      assert.deepEqual(used, [8099]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});

describe('ProxyStateFileStore per profile', () => {
  it('isolates state between profile directories', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-isolated-state-')
    );
    const store: IProxyStateStore = new ProxyStateFileStore();
    const dirA = path.join(tempRoot, 'a');
    const dirB = path.join(tempRoot, 'b');
    await fs.mkdir(dirA, { recursive: true });
    await fs.mkdir(dirB, { recursive: true });

    await store.write(dirA, {
      version: 1,
      profileId: 'a',
      running: true,
      port: 8080,
      lastUpdatedAt: new Date().toISOString(),
    });
    await store.write(dirB, {
      version: 1,
      profileId: 'b',
      running: true,
      port: 8081,
      lastUpdatedAt: new Date().toISOString(),
    });

    const stateA = await store.read(dirA);
    const stateB = await store.read(dirB);
    assert.equal(stateA?.port, 8080);
    assert.equal(stateB?.port, 8081);

    await fs.rm(tempRoot, { recursive: true, force: true });
  });
});
