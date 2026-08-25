import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IProxyApiServer } from '../../domain/ports/IProxyApiServer';
import type { ProxyApiEvent, ProxyApiServerOptions } from '../../application/types/proxyApi';
import type { ProxyStatistics } from '@cursor-accounts/types';
import type { ProxyServerConfig } from '../../application/types/proxyConfig';
import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';
import type {
  ProxyRuntimeServer,
  ProxyServerRuntimeDependencies,
} from '../../application/types/proxyServerRuntime';
import { ProxyServerRuntime } from '../../application/proxyServerRuntime';

const statistics: ProxyStatistics = {
  totalRequests: 3,
  cursorRequests: 2,
  bytesTransferred: 100,
  activeConnections: 1,
};

function config(trafficDiagnostics = true): ProxyServerConfig {
  return {
    port: 8080,
    apiPort: 18080,
    profileId: 'profile-a',
    storageDir: '/tmp/proxy',
    logDir: '/tmp/proxy/logs',
    maxLogSizeMb: 50,
    maxBodyLogBytes: 1024,
    spillLargeBodies: false,
    developmentMode: false,
    trafficDiagnostics,
    diagnosticsIntervalMs: 30_000,
  };
}

function createHarness(options: { proxyStartError?: Error } = {}) {
  const calls: string[] = [];
  const events: ProxyApiEvent[] = [];
  const stderr: string[] = [];
  const enqueued: unknown[] = [];
  let apiOptions: ProxyApiServerOptions | undefined;
  let errorListener: ((error: unknown) => void) | undefined;

  const apiServer: IProxyApiServer = {
    async start(startOptions) {
      calls.push('api.start');
      apiOptions = startOptions;
    },
    async stop() {
      calls.push('api.stop');
    },
    broadcast(event) {
      events.push(event);
    },
    isRunning: () => true,
    getApiPort: () => 18_080,
    getStatus: () => ({ running: true, mitmPort: 8080, apiPort: 18_080 }),
    getStatistics: () => statistics,
    requestShutdown: () => undefined,
  };

  const proxyServer = {
    async start() {
      calls.push('proxy.start');
      if (options.proxyStartError) {
        throw options.proxyStartError;
      }
    },
    async stop() {
      calls.push('proxy.stop');
    },
    getStatistics: () => statistics,
    formatDiagnosticsLines: () => ['diagnostic line'],
    on(event: 'error', listener: (error: unknown) => void) {
      assert.equal(event, 'error');
      errorListener = listener;
      return proxyServer;
    },
  } as unknown as ProxyRuntimeServer;

  const trackingIngress = {
    async enqueue(summary: unknown) {
      calls.push('tracking.enqueue');
      enqueued.push(summary);
    },
    async close() {
      calls.push('tracking.close');
    },
  };

  const dependencies: ProxyServerRuntimeDependencies = {
    apiServer,
    proxyServer,
    trackingIngress,
    writeStderr: (message) => stderr.push(message),
    now: () => '2026-08-25T12:00:00.000Z',
  };

  return {
    runtime: new ProxyServerRuntime(dependencies),
    calls,
    events,
    stderr,
    enqueued,
    getApiOptions: () => apiOptions,
    emitProxyError: (error: unknown) => errorListener?.(error),
  };
}

describe('ProxyServerRuntime', () => {
  it('starts the API before the MITM and emits diagnostics after startup', async () => {
    const harness = createHarness();
    const proxyConfig = config();

    await harness.runtime.start(proxyConfig, 4242);

    assert.deepEqual(harness.calls.slice(0, 2), ['api.start', 'proxy.start']);
    assert.equal(harness.getApiOptions()?.apiPort, 18_080);
    assert.equal(harness.getApiOptions()?.mitmPort, 8080);
    assert.equal(harness.getApiOptions()?.pid, 4242);
    assert.ok(harness.stderr.some((line) => line.includes('MITM listening')));
    assert.deepEqual(
      harness.events.filter((event) => event.type === 'diagnostics'),
      [
        {
          type: 'diagnostics',
          timestamp: '2026-08-25T12:00:00.000Z',
          profileId: 'profile-a',
          data: { lines: ['diagnostic line'] },
        },
      ]
    );

    const shutdown = harness.runtime.shutdown();
    assert.strictEqual(shutdown, harness.runtime.shutdown());
    await shutdown;
    assert.deepEqual(harness.calls.slice(-3), [
      'proxy.stop',
      'tracking.close',
      'api.stop',
    ]);
  });

  it('cleans every started dependency when the MITM fails to start', async () => {
    const harness = createHarness({ proxyStartError: new Error('port busy') });

    await assert.rejects(
      () => harness.runtime.start(config(false), 4242),
      /port busy/
    );
    await harness.runtime.shutdown();

    assert.deepEqual(harness.calls, [
      'api.start',
      'proxy.start',
      'proxy.stop',
      'tracking.close',
      'api.stop',
    ]);
  });

  it('persists redacted traffic and publishes proxy errors through the API', async () => {
    const harness = createHarness();
    const proxyConfig = config(false);
    await harness.runtime.start(proxyConfig, 4242);

    harness.runtime.emitTraffic(proxyConfig, {
      timestamp: '2026-08-25T12:01:00.000Z',
      kind: 'response',
      url: 'https://api2.cursor.sh/test',
      host: 'api2.cursor.sh',
      endpoint: '/test',
      bodyDecoded: { secret: 'must not be persisted' },
    });
    harness.emitProxyError(new Error('upstream failed'));

    assert.equal(harness.enqueued.length, 1);
    const trafficEvent = harness.events.find((event) => event.type === 'traffic');
    assert.equal(trafficEvent?.type, 'traffic');
    if (trafficEvent?.type === 'traffic') {
      assert.equal(trafficEvent.profileId, 'profile-a');
      const trafficData = trafficEvent.data as ProxyTrafficSummary;
      assert.equal(trafficData.bodyDecoded, undefined);
    }
    assert.deepEqual(harness.events.at(-1), {
      type: 'error',
      timestamp: '2026-08-25T12:00:00.000Z',
      profileId: 'profile-a',
      data: { message: 'upstream failed', kind: 'PROXY_ERROR' },
    });
    assert.deepEqual(harness.stderr, [
      '[proxy] MITM listening on 127.0.0.1:8080, API on 127.0.0.1:18080\n',
      '[proxy] upstream failed\n',
    ]);

    await harness.runtime.shutdown();
  });
});
