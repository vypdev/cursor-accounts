import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { IProfileManager } from '../../../../domain/ports/IProfileManager';
import { MultiplexerRegistry } from '../../../../application/services/multiplexerRegistry';
import { ManagementApiClient } from '../../../../proxy/multiplexer/api/managementApiClient';

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

describe('Management API', { concurrency: 1 }, () => {
  let registry: MultiplexerRegistry;
  let apiClient: ManagementApiClient;
  let testPort: number;
  const tempRoot = path.join(os.tmpdir(), `mux-api-test-${process.pid}`);
  let nextPort = 20_000 + (process.pid % 1000);

  function allocateTestPort(): number {
    return nextPort++;
  }

  beforeEach(async () => {
    testPort = allocateTestPort();
    registry = new MultiplexerRegistry(
      createMockProfileManager(),
      tempRoot,
      process.cwd()
    );
    apiClient = new ManagementApiClient(`http://127.0.0.1:${testPort}`);
    await registry.ensureStarted({ router: { port: testPort, host: '127.0.0.1' } });
  });

  afterEach(async () => {
    apiClient.disconnect();
    await registry.stopAll();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it('returns health and status', async () => {
    assert.equal(await apiClient.getHealth(), true);
    const status = await apiClient.getStatus();
    assert.equal(status.running, true);
    assert.equal(status.port, testPort);
  });

  it('returns metrics and config', async () => {
    const metrics = await apiClient.getMetrics();
    assert.ok(metrics.snapshot);
    assert.equal(metrics.routerPort, testPort);

    const config = await apiClient.getConfig();
    assert.equal(config.router.port, testPort);
    assert.ok(config.routing.strategy);
  });

  it('creates, lists, and deletes upstream workers', async () => {
    const created = await apiClient.createUpstream(
      'profile-a',
      '/workspace/api-test'
    );
    assert.ok(created.upstreamId);

    const upstreams = await apiClient.getUpstreams('profile-a');
    assert.equal(upstreams.length, 1);
    assert.equal(upstreams[0]?.metadata?.workspacePath, '/workspace/api-test');
    assert.equal(upstreams[0]?.healthy, true);

    await apiClient.deleteUpstreamsByProfile('profile-a');
    assert.equal((await apiClient.getUpstreams('profile-a')).length, 0);
  });

  it('returns sessions list', async () => {
    const sessions = await apiClient.getSessions();
    assert.ok(Array.isArray(sessions));
  });

  it('updates cache from websocket notifications', async () => {
    let notified = false;
    apiClient.connectWebSocket();
    await apiClient.waitForWebSocketOpen();
    apiClient.onNotification('upstream_created', () => {
      notified = true;
    });

    await apiClient.createUpstream('profile-a', '/workspace/ws-test');

    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(notified, true);
    assert.ok(apiClient.getCachedUpstreams().length >= 1);
  });
});
