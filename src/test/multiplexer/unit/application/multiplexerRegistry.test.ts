import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { IProfileManager } from '../../../../domain/ports/IProfileManager';
import { MultiplexerRegistry } from '../../../../application/services/multiplexerRegistry';
import { ManagementApiClient } from '../../../../proxy/multiplexer/api/managementApiClient';

function createMockProfileManager(): IProfileManager {
  return {
    initialize: async () => undefined,
    getProfiles: async () => [
      { id: 'profile-a', email: 'a@example.com', userDataDir: '/tmp/profile-a' } as never,
      { id: 'profile-b', email: 'b@example.com', userDataDir: '/tmp/profile-b' } as never,
    ],
    getProfile: async (id) =>
      id === 'profile-a' || id === 'profile-b'
        ? ({
            id,
            email: `${id}@example.com`,
            userDataDir: `/tmp/${id}`,
          } as never)
        : undefined,
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

describe('MultiplexerRegistry', { concurrency: 1 }, () => {
  const registries: MultiplexerRegistry[] = [];
  const apiClients: ManagementApiClient[] = [];
  const tempRoot = path.join(os.tmpdir(), `mux-registry-test-${process.pid}`);
  let nextPort = 19_500 + (process.pid % 1000);

  function allocateTestPort(): number {
    return nextPort++;
  }

  afterEach(async () => {
    for (const client of apiClients.splice(0)) {
      client.disconnect();
    }
    for (const registry of registries.splice(0)) {
      await registry.stopAll();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  function createRegistry(): {
    registry: MultiplexerRegistry;
    apiClient: ManagementApiClient;
    port: number;
  } {
    const port = allocateTestPort();
    const registry = new MultiplexerRegistry(
      createMockProfileManager(),
      tempRoot,
      process.cwd(),
      undefined,
      port
    );
    const apiClient = new ManagementApiClient(`http://127.0.0.1:${port}`);
    registries.push(registry);
    apiClients.push(apiClient);
    return { registry, apiClient, port };
  }

  it('singleton reuses global multiplexer on port 9000', async () => {
    const { registry, apiClient, port } = createRegistry();

    await registry.ensureStarted({ router: { port, host: '127.0.0.1' } });
    await registry.ensureStarted({ router: { port, host: '127.0.0.1' } });

    assert.equal(registry.isRunning(), true);

    const status = await apiClient.getStatus();
    assert.equal(status.port, port);
    assert.equal(status.running, true);
  });

  it('creates upstream worker via management API', async () => {
    const { registry, apiClient, port } = createRegistry();
    await registry.ensureStarted({ router: { port, host: '127.0.0.1' } });

    const result = await apiClient.createUpstream(
      'profile-a',
      '/workspace/project-x'
    );

    assert.ok(result.upstreamId);

    const upstreams = await apiClient.getUpstreams('profile-a');
    assert.equal(upstreams.length, 1);
    assert.equal(upstreams[0]?.id, result.upstreamId);
    assert.equal(upstreams[0]?.metadata?.workspacePath, '/workspace/project-x');
  });

  it('stopUpstreamsForProfile removes workers without stopping global router', async () => {
    const { registry, apiClient, port } = createRegistry();
    await registry.ensureStarted({ router: { port, host: '127.0.0.1' } });
    await apiClient.createUpstream('profile-a', '/workspace/a');

    await apiClient.deleteUpstreamsByProfile('profile-a');

    assert.equal(registry.isRunning(), true);
    const upstreams = await apiClient.getUpstreams('profile-a');
    assert.equal(upstreams.length, 0);
  });

  it('stopAll stops global multiplexer and all upstream workers', async () => {
    const { registry, apiClient, port } = createRegistry();
    await registry.ensureStarted({ router: { port, host: '127.0.0.1' } });
    await apiClient.createUpstream('profile-a', '/workspace/a');

    await registry.stopAll();

    assert.equal(registry.isRunning(), false);
  });

  it('createUpstreamWorker registers worker at launch time', async () => {
    const { registry, apiClient, port } = createRegistry();
    await registry.ensureStarted({ router: { port, host: '127.0.0.1' } });

    const upstreamId = await registry.createUpstreamWorker(
      'profile-a',
      '/workspace/launch',
      '/tmp/profile-a'
    );

    assert.ok(upstreamId);
    
    // Small delay to ensure worker registration completes
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const upstreams = await apiClient.getUpstreams('profile-a');
    assert.equal(upstreams.length, 1);
  });
});
