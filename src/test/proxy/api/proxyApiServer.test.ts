import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import WebSocket from 'ws';
import type { ProxyApiEvent } from '../../../application/types/proxyApi';
import { PROXY_API_PATHS } from '../../../application/types/proxyApi';
import { ProxyApiServer } from '../../../proxy/api/proxyApiServer';

describe('ProxyApiServer', () => {
  it('exposes REST endpoints and broadcasts WebSocket events to localhost clients', async () => {
    const apiPort = 19_080;
    const server = new ProxyApiServer();
    let shutdownRequested = false;

    await server.start({
      apiPort,
      mitmPort: 8080,
      profileId: 'profile-a',
      pid: process.pid,
      startedAt: new Date().toISOString(),
      getStatistics: () => ({
        totalRequests: 3,
        cursorRequests: 2,
        bytesTransferred: 100,
        activeConnections: 1,
      }),
      onShutdownRequested: () => {
        shutdownRequested = true;
      },
    });

    try {
      const health = await fetch(`http://127.0.0.1:${apiPort}${PROXY_API_PATHS.health}`);
      assert.equal(health.status, 200);
      const healthBody = (await health.json()) as { ok: boolean };
      assert.equal(healthBody.ok, true);

      const status = await fetch(`http://127.0.0.1:${apiPort}${PROXY_API_PATHS.status}`);
      const statusBody = (await status.json()) as { running: boolean; apiPort: number };
      assert.equal(statusBody.running, true);
      assert.equal(statusBody.apiPort, apiPort);

      const stats = await fetch(`http://127.0.0.1:${apiPort}${PROXY_API_PATHS.stats}`);
      const statsBody = (await stats.json()) as { totalRequests: number };
      assert.equal(statsBody.totalRequests, 3);

      const received = await new Promise<ProxyApiEvent>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${apiPort}${PROXY_API_PATHS.ws}`);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('timed out waiting for ws event'));
        }, 3000);

        ws.once('open', () => {
          server.broadcast({
            type: 'traffic',
            timestamp: new Date().toISOString(),
            profileId: 'profile-a',
            data: {
              timestamp: new Date().toISOString(),
              kind: 'response',
              url: 'https://api2.cursor.sh/x',
              host: 'api2.cursor.sh',
              endpoint: '/x',
            },
          });
        });

        ws.once('message', (data) => {
          clearTimeout(timeout);
          ws.close();
          resolve(JSON.parse(String(data)) as ProxyApiEvent);
        });
      });

      assert.equal(received.type, 'traffic');

      const shutdown = await fetch(
        `http://127.0.0.1:${apiPort}${PROXY_API_PATHS.shutdown}`,
        { method: 'POST' }
      );
      assert.equal(shutdown.status, 200);
      assert.equal(shutdownRequested, true);
    } finally {
      await server.stop();
    }
  });

  it('requires the configured capability token for HTTP control-plane access', async () => {
    const apiPort = 19_081;
    const apiToken = 'a'.repeat(64);
    const server = new ProxyApiServer();
    await server.start({
      apiPort,
      mitmPort: 8081,
      apiToken,
      startedAt: new Date().toISOString(),
      getStatistics: () => ({
        totalRequests: 0,
        cursorRequests: 0,
        bytesTransferred: 0,
        activeConnections: 0,
      }),
    });

    try {
      const unauthorized = await fetch(
        `http://127.0.0.1:${apiPort}${PROXY_API_PATHS.health}`
      );
      assert.equal(unauthorized.status, 401);

      const authorized = await fetch(
        `http://127.0.0.1:${apiPort}${PROXY_API_PATHS.health}`,
        { headers: { authorization: `Bearer ${apiToken}` } }
      );
      assert.equal(authorized.status, 200);

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${apiPort}${PROXY_API_PATHS.ws}`
        );
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('unauthorized WebSocket was not rejected'));
        }, 3000);
        ws.once('open', () => {
          clearTimeout(timeout);
          ws.close();
          reject(new Error('unauthorized WebSocket was accepted'));
        });
        ws.once('error', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${apiPort}${PROXY_API_PATHS.ws}`,
          { headers: { authorization: `Bearer ${apiToken}` } }
        );
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('authorized WebSocket did not connect'));
        }, 3000);
        ws.once('open', () => {
          clearTimeout(timeout);
          ws.close();
          resolve();
        });
        ws.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } finally {
      await server.stop();
    }
  });
});
