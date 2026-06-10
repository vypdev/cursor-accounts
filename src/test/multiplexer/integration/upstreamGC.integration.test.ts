import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { IProfileManager } from '../../../domain/ports/IProfileManager';
import { MultiplexerRegistry } from '../../../application/services/multiplexerRegistry';
import { ManagementApiClient } from '../../../proxy/multiplexer/api/managementApiClient';

function createMockProfileManager(): IProfileManager {
  return {
    initialize: async () => undefined,
    getProfiles: async () => [
      { id: 'profile-a', userDataDir: '/tmp/profile-a' } as never,
    ],
    getProfile: async () =>
      ({ id: 'profile-a', userDataDir: '/tmp/profile-a' } as never),
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
      totalProfiles: 1,
      profilesWithTheme: 0,
      averageAge: 0,
    }),
  };
}

type RegistryInternals = {
  cleanupIdleUpstreams(): Promise<void>;
  recordUpstreamActivity(profileId: string, upstreamId: string): void;
};

describe('Upstream garbage collection', { concurrency: 1 }, () => {
  const registries: MultiplexerRegistry[] = [];
  const apiClients: ManagementApiClient[] = [];
  const tempRoot = path.join(os.tmpdir(), `mux-gc-test-${process.pid}`);
  let nextPort = 20_500 + (process.pid % 1000);

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

  function internals(registry: MultiplexerRegistry): RegistryInternals {
    return registry as unknown as RegistryInternals;
  }

  it('removes idle upstream workers after TTL without activity', async () => {
    const { registry, apiClient, port } = createRegistry();
    await registry.ensureStarted({ router: { port, host: '127.0.0.1' } });

    const result = await apiClient.createUpstream('profile-a', '/workspace/idle');
    assert.equal((await apiClient.getUpstreams('profile-a')).length, 1);

    const activity = (
      registry as unknown as {
        upstreamActivity: Map<string, Map<string, number>>;
      }
    ).upstreamActivity;
    
    // Initialize profile activity map if it doesn't exist
    let profileActivity = activity.get('profile-a');
    if (!profileActivity) {
      profileActivity = new Map();
      activity.set('profile-a', profileActivity);
    }
    profileActivity.set(result.upstreamId, Date.now() - 31 * 60 * 1000);

    await internals(registry).cleanupIdleUpstreams();

    assert.equal((await apiClient.getUpstreams('profile-a')).length, 0);
    assert.notEqual(result.upstreamId, '');
  });

  it('keeps active upstream workers alive', async () => {
    const { registry, apiClient, port } = createRegistry();
    await registry.ensureStarted({ router: { port, host: '127.0.0.1' } });

    const result = await apiClient.createUpstream(
      'profile-a',
      '/workspace/active'
    );

    internals(registry).recordUpstreamActivity('profile-a', result.upstreamId);

    await internals(registry).cleanupIdleUpstreams();

    assert.equal((await apiClient.getUpstreams('profile-a')).length, 1);
  });
});
