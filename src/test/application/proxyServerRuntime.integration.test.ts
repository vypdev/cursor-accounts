import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { PROXY_API_PATHS } from '../../application/types/proxyApi';
import { ProxyServerRuntime } from '../../application/proxyServerRuntime';
import type { ProxyServerConfig } from '../../application/types/proxyConfig';
import type {
  ProxyRuntimeServer,
  ProxyServerRuntimeDependencies,
} from '../../application/types/proxyServerRuntime';
import { ProxyApiServer } from '../../proxy/api/proxyApiServer';
import { CertificateManager } from '../../proxy/certificateManager';
import { MitmCertificateDirectory } from '../../proxy/mitmCertificateDirectory';
import { NullLogger } from '../../proxy/nullLogger';
import { PolyglotMitmProxyServer } from '../../proxy/polyglotMitmProxyServer';
import { isPortAvailable } from '../../proxy/portUtils';

function config(apiPort: number): ProxyServerConfig {
  return {
    port: apiPort + 1,
    apiPort,
    profileId: 'profile-a',
    storageDir: '/tmp/proxy-runtime-integration',
    logDir: '/tmp/proxy-runtime-integration/logs',
    maxLogSizeMb: 1,
    maxBodyLogBytes: 1024,
    spillLargeBodies: false,
    developmentMode: false,
    trafficDiagnostics: false,
    diagnosticsIntervalMs: 30_000,
  };
}

async function reservePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 20; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port near ${preferred}`);
}

function createRuntimeHarness(
  apiPort: number,
  onShutdownRequested?: (shutdown: Promise<void>) => void
) {
  const calls: string[] = [];
  const apiServer = new ProxyApiServer();
  const proxyServer: ProxyRuntimeServer = {
    async start() {
      calls.push('proxy.start');
    },
    async stop() {
      calls.push('proxy.stop');
    },
    getStatistics: () => ({
      totalRequests: 0,
      cursorRequests: 0,
      bytesTransferred: 0,
      activeConnections: 0,
    }),
    formatDiagnosticsLines: () => [],
    on(_event, _listener) {
      return this;
    },
  };
  const trackingIngress = {
    async enqueue() {
      calls.push('tracking.enqueue');
    },
    async close() {
      calls.push('tracking.close');
    },
  };
  const dependencies: ProxyServerRuntimeDependencies = {
    apiServer,
    proxyServer,
    trackingIngress,
    writeStderr: () => undefined,
    now: () => '2026-08-25T12:00:00.000Z',
    onShutdownRequested,
  };

  return {
    runtime: new ProxyServerRuntime(dependencies),
    calls,
    apiServer,
    proxyConfig: config(apiPort),
  };
}

const blockers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(
    blockers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
});

describe('ProxyServerRuntime integration', () => {
  it('starts the real API, exposes health, and shuts down through its HTTP route', async () => {
    const apiPort = await reservePort(19_200);
    let shutdownPromise: Promise<void> | undefined;
    const harness = createRuntimeHarness(apiPort, (shutdown) => {
      shutdownPromise = shutdown;
    });

    await harness.runtime.start(harness.proxyConfig, process.pid);
    try {
      const health = await fetch(
        `http://127.0.0.1:${apiPort}${PROXY_API_PATHS.health}`
      );
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { ok: true, version: 1 });

      const shutdown = await fetch(
        `http://127.0.0.1:${apiPort}${PROXY_API_PATHS.shutdown}`,
        { method: 'POST' }
      );
      assert.equal(shutdown.status, 200);
      await shutdownPromise;
      assert.ok(shutdownPromise);
    } finally {
      await harness.runtime.shutdown();
    }
  });

  it('cleans up partially started dependencies when the API port is occupied', async () => {
    const apiPort = await reservePort(19_220);
    const blocker = net.createServer();
    blockers.push(blocker);
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(apiPort, '127.0.0.1', () => resolve());
    });

    const harness = createRuntimeHarness(apiPort);
    await assert.rejects(
      () => harness.runtime.start(harness.proxyConfig, process.pid),
      /EADDRINUSE|address already in use/
    );

    await harness.runtime.shutdown();
    assert.deepEqual(harness.calls, ['proxy.stop', 'tracking.close']);
  });

  it(
    'starts and stops the real MITM listener and API as one runtime',
    { timeout: 30_000 },
    async () => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'proxy-runtime-integration-')
      );
      const proxyPort = await reservePort(19_240);
      const apiPort = await reservePort(19_260);
      const proxyServer = new PolyglotMitmProxyServer(
        new MitmCertificateDirectory(
          path.join(tempDir, 'certs'),
          new CertificateManager(path.join(tempDir, 'certs'))
        ),
        new NullLogger()
      );
      const apiServer = new ProxyApiServer();
      const runtime = new ProxyServerRuntime({
        apiServer,
        proxyServer,
        writeStderr: () => undefined,
        now: () => '2026-08-25T12:00:00.000Z',
      });

      try {
        await runtime.start(
          {
            ...config(apiPort),
            port: proxyPort,
            storageDir: tempDir,
            logDir: path.join(tempDir, 'logs'),
          },
          process.pid
        );

        const status = await fetch(
          `http://127.0.0.1:${apiPort}${PROXY_API_PATHS.status}`
        );
        assert.equal(status.status, 200);
        const statusBody = (await status.json()) as {
          running?: unknown;
          mitmPort?: unknown;
          apiPort?: unknown;
          profileId?: unknown;
          pid?: unknown;
          startedAt?: unknown;
          uptimeMs?: unknown;
        };
        assert.equal(statusBody.running, true);
        assert.equal(statusBody.mitmPort, proxyPort);
        assert.equal(statusBody.apiPort, apiPort);
        assert.equal(statusBody.profileId, 'profile-a');
        assert.ok(typeof statusBody.pid === 'number' && statusBody.pid > 0);
        assert.equal(statusBody.startedAt, '2026-08-25T12:00:00.000Z');
        assert.ok(
          typeof statusBody.uptimeMs === 'number' && statusBody.uptimeMs >= 0
        );
      } finally {
        await runtime.shutdown();
        await fs.rm(tempDir, { recursive: true, force: true });
      }

      assert.equal(apiServer.isRunning(), false);
      assert.deepEqual(proxyServer.getStatistics(), {
        totalRequests: 0,
        cursorRequests: 0,
        bytesTransferred: 0,
        activeConnections: 0,
      });
    }
  );
});
