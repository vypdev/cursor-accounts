import assert from 'node:assert/strict';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import type { IProfileManager } from '../../../domain/ports/IProfileManager';
import { MultiplexerRegistry } from '../../../application/services/multiplexerRegistry';
import { ManagementApiClient } from '../../../proxy/multiplexer/api/managementApiClient';

function connectViaProxy(routerPort: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(routerPort, '127.0.0.1', () => {
      socket.write(
        'CONNECT api2.cursor.sh:443 HTTP/1.1\r\nHost: api2.cursor.sh:443\r\n\r\n'
      );
    });
    socket.once('data', (chunk) => {
      const response = chunk.toString();
      resolve(
        response.includes('200 Connection Established') || response.includes('200 OK')
      );
      socket.end();
    });
    socket.setTimeout(5_000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function createMockProfileManager(): IProfileManager {
  return {
    initialize: async () => undefined,
    getProfiles: async () => [
      { id: 'profile-a', userDataDir: '/tmp/profile-a' } as never,
      { id: 'profile-b', userDataDir: '/tmp/profile-b' } as never,
    ],
    getProfile: async (id) =>
      ({ id, userDataDir: `/tmp/${id}` } as never),
    findProfileByEmail: async () => undefined,
    findProfileByPath: async () => undefined,
    createProfile: async () => {
      throw new Error('not implemented');
    },
    updateProfile: async () => {
      throw new Error('not implemented');
    },
    deleteProfile: async () => undefined,
    validateEmail: () => ({ valid: true, errors: [] }),
    isProfilePathValid: async () => true,
    backup: async () => '/tmp/backup',
    getStats: async () => ({
      totalProfiles: 2,
      profilesWithTheme: 0,
      averageAge: 0,
    }),
  };
}

describe('Global multiplexer integration', { concurrency: 1 }, () => {
  const tempRoot = path.join(os.tmpdir(), `mux-global-test-${process.pid}`);
  let nextPort = 19_000 + (process.pid % 1000);

  function allocateTestPort(): number {
    return nextPort++;
  }

  it('MITM multiplexer proxies CONNECT and registers upstream workers', async () => {
    const port = allocateTestPort();
    const registry = new MultiplexerRegistry(
      createMockProfileManager(),
      tempRoot,
      process.cwd()
    );
    const apiClient = new ManagementApiClient(`http://127.0.0.1:${port}`);

    try {
      await registry.ensureStarted({ router: { port, host: '127.0.0.1' } });

      await apiClient.createUpstream('profile-a', '/workspace/profile-a');
      await apiClient.createUpstream('profile-b', '/workspace/profile-b');

      const connected = await connectViaProxy(port);
      assert.equal(connected, true);
      assert.equal((await apiClient.getUpstreams('profile-a')).length, 1);
      assert.equal((await apiClient.getUpstreams('profile-b')).length, 1);
    } finally {
      apiClient.disconnect();
      await registry.stopAll();
    }
  });

  it('creates upstream workers per profile and workspace', async () => {
    const port = allocateTestPort();
    const registry = new MultiplexerRegistry(
      createMockProfileManager(),
      tempRoot,
      process.cwd()
    );
    const apiClient = new ManagementApiClient(`http://127.0.0.1:${port}`);

    try {
      await registry.ensureStarted({ router: { port, host: '127.0.0.1' } });
      const result = await apiClient.createUpstream(
        'profile-a',
        '/workspace/project-x'
      );

      const upstreams = await apiClient.getUpstreams('profile-a');
      const upstream = upstreams.find((item) => item.id === result.upstreamId);

      assert.ok(upstream);
      assert.equal(upstream?.id, result.upstreamId);
      assert.match(result.upstreamId, /profile-a-/);
      assert.equal(upstream?.metadata?.workspacePath, '/workspace/project-x');
    } finally {
      apiClient.disconnect();
      await registry.stopAll();
    }
  });
});
