import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import type { IMultiplexerServer } from '../../../../domain/ports/IMultiplexerServer';
import type { ISessionStore } from '../../../../domain/ports/ISessionStore';
import type { IUpstreamWorkerRegistry } from '../../../../domain/ports/IUpstreamWorkerRegistry';
import type { ProxyServerConfig } from '../../../../application/types/proxyConfig';
import { MultiplexerService } from '../../../../application/services/multiplexerService';
import { MetricsAggregator } from '../../../../application/services/metricsAggregator';
import type { MultiplexerConfig } from '../../../../application/types/multiplexerConfig';
import type { UpstreamWorkerManager } from '../../../../proxy/multiplexer/upstreamWorkerManager';
import { MultiplexerMetricsCollector } from '../../../../proxy/multiplexer/metrics/multiplexerMetricsCollector';

const baseConfig: MultiplexerConfig = {
  router: { port: 19999, host: '127.0.0.1' },
  routing: { strategy: 'workspace-path', sessionTimeoutMs: 60_000 },
  health: { checkIntervalMs: 60_000, timeoutMs: 1_000, unhealthyThreshold: 3 },
};

describe('MultiplexerService', () => {
  it('starts MITM server and stops cleanly', async () => {
    let started = false;
    let stopped = false;
    let stopWorkersCalled = false;

    const server: IMultiplexerServer = {
      start: async (_config: ProxyServerConfig) => {
        started = true;
      },
      stop: async () => {
        stopped = true;
      },
      close: async () => {
        stopped = true;
      },
      isListening: () => started && !stopped,
      getPort: () => (started && !stopped ? 19999 : undefined),
    };

    const workerRegistry: IUpstreamWorkerRegistry = {
      register: () => undefined,
      unregister: () => undefined,
      getById: () => undefined,
      getByWorkspace: () => undefined,
      listByProfile: () => [],
      getAll: () => [],
      recordTraffic: () => undefined,
      setHealthy: () => undefined,
    };

    const sessionStore: ISessionStore = {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      getByWorkspace: () => undefined,
      setWorkspaceMapping: () => {},
      list: () => [],
      clearExpired: () => 0,
    };

    const upstreamWorkerManager = {
      stopAll: async () => {
        stopWorkersCalled = true;
      },
    } as unknown as UpstreamWorkerManager;

    const metricsAggregator = new MetricsAggregator(
      new MultiplexerMetricsCollector(),
      workerRegistry
    );

    const service = new MultiplexerService(
      server,
      upstreamWorkerManager,
      sessionStore,
      metricsAggregator,
      {
        storageDir: path.join(os.tmpdir(), 'mux-service-test'),
        logDir: path.join(os.tmpdir(), 'mux-service-logs'),
        extensionPath: process.cwd(),
      }
    );

    await service.start(baseConfig);

    assert.equal(started, true);
    assert.equal(service.isRunning(), true);
    assert.deepEqual(service.getConfig(), baseConfig);

    await service.stop();
    assert.equal(stopped, true);
    assert.equal(stopWorkersCalled, true);
    assert.equal(service.isRunning(), false);
    assert.equal(service.getConfig(), null);
  });
});
