import assert from 'node:assert/strict';
import * as http from 'node:http';
import * as net from 'node:net';
import { after, describe, it } from 'node:test';
import type { IProfileManager } from '../../../domain/ports/IProfileManager';
import type { IProxyManager } from '../../../domain/ports/IProxyManager';
import { MultiplexerRegistry } from '../../../application/services/multiplexerRegistry';

let nextPort = 19_300 + (process.pid % 100);

function allocatePort(): number {
  return nextPort++;
}

async function startMockUpstream(port: number): Promise<http.Server> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  server.on('connect', (_req, clientSocket, head) => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) {
      clientSocket.write(head);
    }
    clientSocket.end();
  });
  return server;
}

function connectViaProxy(routerPort: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(routerPort, '127.0.0.1', () => {
      socket.write(
        'CONNECT api2.cursor.sh:443 HTTP/1.1\r\nHost: api2.cursor.sh:443\r\n\r\n'
      );
    });
    socket.once('data', (chunk) => {
      resolve(chunk.toString().includes('200 Connection Established'));
      socket.end();
    });
    socket.setTimeout(2_000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function createMockProfileManager(): IProfileManager {
  return {
    initialize: async () => undefined,
    getProfiles: async () => [
      { id: 'profile-a' } as never,
      { id: 'profile-b' } as never,
    ],
    getProfile: async (id) => ({ id } as never),
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

function createIntegrationProxyManager(
  upstreamServers: http.Server[]
): IProxyManager {
  return {
    start: async () => ({ success: true, port: 8080 }),
    startUpstream: async (_upstreamId, _options) => {
      const port = allocatePort();
      upstreamServers.push(await startMockUpstream(port));
      return { success: true, port };
    },
    stop: async () => undefined,
    stopUpstream: async () => undefined,
    getRuntimeMetadata: () => undefined,
    restartProfileProxy: async () => ({ success: true, port: 8080 }),
    getStatus: async () => null,
    isRunning: async () => false,
    isCurrentWindowUsingProxy: async () => false,
    getCertificatePath: async () => null,
    getLogDirectory: () => '/tmp/logs',
    getProxyInstallGuide: async () => ({
      platform: 'darwin',
      certAvailable: false,
      certPath: undefined,
      title: 'Install',
      intro: 'Intro',
      steps: [],
    }),
    installCertificate: async () => ({ success: true }),
    uninstallCertificate: async () => ({ success: true }),
    checkCertificateInstalled: async () => false,
    getCachedCertificateInstalled: () => undefined,
    getProxyServerUrl: async () => null,
    getAllUsedPorts: async () => [],
    ensureProfileProxy: async () => ({ success: true, port: 8080 }),
    restoreAllProfileProxySettings: async () => ({ restored: 0, errors: [] }),
    onStatusChange: () => undefined,
    ensureOutputTailer: async () => undefined,
    ensureTrafficTailer: async () => undefined,
    showOutputChannel: () => undefined,
    showTokenDetectorChannel: () => undefined,
  };
}

describe('Global multiplexer integration', { concurrency: 1 }, () => {
  const upstreamServers: http.Server[] = [];

  after(async () => {
    for (const server of upstreamServers) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('shares port 9000 across profiles', async () => {
    const registry = new MultiplexerRegistry(
      createIntegrationProxyManager(upstreamServers),
      createMockProfileManager()
    );

    await registry.ensureStarted();
    assert.equal(registry.getProxyServerUrl(), 'http://127.0.0.1:9000');

    await registry.createUpstreamForWorkspace('profile-a', '/workspace/profile-a');
    await registry.createUpstreamForWorkspace('profile-b', '/workspace/profile-b');

    const connected = await connectViaProxy(9000);
    assert.equal(connected, true);
    assert.equal(registry.listUpstreamsForProfile('profile-a').length, 1);
    assert.equal(registry.listUpstreamsForProfile('profile-b').length, 1);

    await registry.stopAll();
  });

  it('creates upstreams per profile and workspace', async () => {
    const registry = new MultiplexerRegistry(
      createIntegrationProxyManager(upstreamServers),
      createMockProfileManager()
    );

    await registry.ensureStarted();
    const upstreamId = await registry.createUpstreamForWorkspace(
      'profile-a',
      '/workspace/project-x'
    );

    const runtime = registry.getRuntime();
    const upstream = runtime?.upstreamPool.getByWorkspace(
      '/workspace/project-x',
      'profile-a'
    );

    assert.ok(upstream);
    assert.equal(upstream?.id, upstreamId);
    assert.match(upstreamId, /profile-a-/);

    await registry.stopAll();
  });
});
