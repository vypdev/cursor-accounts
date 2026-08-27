import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProxyApiEvent } from '../../application/types/proxyApi';
import { PROXY_API_PATHS } from '../../application/types/proxyApi';
import {
  buildProxyApiBaseUrl,
  ProxyApiClient,
  resolveProxyApiPort,
} from '../../proxy/api/proxyApiClient';
import { ProxyApiServer } from '../../proxy/api/proxyApiServer';

const BASE_API_PORT = 19_082;

function trafficEvent(): ProxyApiEvent {
  return {
    type: 'traffic',
    timestamp: '2026-08-27T00:00:00.000Z',
    profileId: 'profile-a',
    data: {
      timestamp: '2026-08-27T00:00:00.000Z',
      kind: 'response',
      url: 'https://api2.cursor.sh/v1/test',
      host: 'api2.cursor.sh',
      endpoint: '/v1/test',
    },
  };
}

function serverOptions(apiPort: number, apiToken?: string) {
  return {
    apiPort,
    mitmPort: apiPort - 10_000,
    apiToken,
    profileId: 'profile-a',
    pid: process.pid,
    startedAt: '2026-08-27T00:00:00.000Z',
    getStatistics: () => ({
      totalRequests: 3,
      cursorRequests: 2,
      bytesTransferred: 100,
      activeConnections: 1,
    }),
  };
}

describe('ProxyApiClient', () => {
  it('reads REST state and receives WebSocket events', async () => {
    const server = new ProxyApiServer();
    const client = new ProxyApiClient({
      baseUrl: `http://127.0.0.1:${BASE_API_PORT}/`,
      reconnect: false,
    });
    await server.start(serverOptions(BASE_API_PORT));

    try {
      let unsubscribe: (() => void) | undefined;
      const receivedEvent = new Promise<ProxyApiEvent>((resolve) => {
        unsubscribe = client.onEvent(resolve);
      });

      await client.connect();
      assert.equal(client.isConnected(), true);

      const status = await client.getStatus();
      assert.equal(status.running, true);
      assert.equal(status.apiPort, BASE_API_PORT);

      const stats = await client.getStats();
      assert.equal(stats.totalRequests, 3);
      assert.equal(stats.cursorRequests, 2);

      server.broadcast(trafficEvent());
      assert.deepEqual(await receivedEvent, trafficEvent());

      unsubscribe?.();
      client.disconnect();
      assert.equal(client.isConnected(), false);
    } finally {
      client.disconnect();
      await server.stop();
    }
  });

  it('sends the capability token to REST and WebSocket endpoints', async () => {
    const apiPort = BASE_API_PORT + 1;
    const apiToken = 'a'.repeat(64);
    const server = new ProxyApiServer();
    await server.start(serverOptions(apiPort, apiToken));

    const unauthorizedClient = new ProxyApiClient({
      baseUrl: `http://127.0.0.1:${apiPort}`,
      reconnect: false,
    });
    const authorizedClient = new ProxyApiClient({
      baseUrl: `http://127.0.0.1:${apiPort}`,
      apiToken,
      reconnect: false,
    });

    try {
      await assert.rejects(
        unauthorizedClient.getStatus(),
        /Proxy API status failed: HTTP 401/
      );
      await assert.rejects(
        unauthorizedClient.getStats(),
        /Proxy API stats failed: HTTP 401/
      );
      await assert.rejects(
        unauthorizedClient.shutdown(),
        /Proxy API shutdown failed: HTTP 401/
      );

      await authorizedClient.connect();
      assert.equal((await authorizedClient.getStatus()).running, true);
      await authorizedClient.shutdown();
    } finally {
      unauthorizedClient.disconnect();
      authorizedClient.disconnect();
      await server.stop();
    }
  });

  it('fails closed when the initial WebSocket connection cannot be established', async () => {
    const client = new ProxyApiClient({
      baseUrl: 'http://127.0.0.1:19084',
      connectTimeoutMs: 50,
      reconnect: false,
    });

    await assert.rejects(client.connect());
    assert.equal(client.isConnected(), false);
    client.disconnect();
  });

  it('normalizes API URLs and resolves persisted API ports', () => {
    const client = new ProxyApiClient({ baseUrl: 'http://127.0.0.1:19085/' });
    assert.equal(client.baseUrl, 'http://127.0.0.1:19085');
    assert.equal(buildProxyApiBaseUrl(19085), 'http://127.0.0.1:19085');
    assert.equal(resolveProxyApiPort(8080, 10_000), 18_080);
    assert.equal(resolveProxyApiPort(8080, 10_000, 19_085), 19_085);
    assert.equal(PROXY_API_PATHS.status, '/api/status');
  });
});
