import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Session } from '../../../../domain/entities/Session';
import type { IMultiplexerServer } from '../../../../domain/ports/IMultiplexerServer';
import type { IUpstreamPool } from '../../../../domain/ports/IUpstreamPool';
import type { ISessionStore } from '../../../../domain/ports/ISessionStore';
import type { RoutingContext } from '../../../../domain/ports/IRoutingStrategy';
import { MultiplexerService } from '../../../../application/services/multiplexerService';
import { RoutingOrchestrator } from '../../../../application/services/routingOrchestrator';
import { UpstreamHealthMonitor } from '../../../../application/services/upstreamHealthMonitor';
import type { MultiplexerConfig } from '../../../../application/types/multiplexerConfig';
import { Upstream } from '../../../../domain/entities/Upstream';
import { RoutingDecision } from '../../../../domain/entities/RoutingDecision';

const baseConfig: MultiplexerConfig = {
  router: { port: 19999, host: '127.0.0.1' },
  upstreams: [{ id: 'u1', host: '127.0.0.1', port: 8080 }],
  routing: { strategy: 'sticky-session', sessionTimeoutMs: 60_000 },
  health: { checkIntervalMs: 60_000, timeoutMs: 1_000, unhealthyThreshold: 3 },
};

describe('MultiplexerService', () => {
  it('starts server, initializes pool, and begins health monitoring', async () => {
    let listening = false;
    let poolInitialized = false;
    let healthStarted = false;

    const server: IMultiplexerServer = {
      listen: async () => {
        listening = true;
      },
      close: async () => {
        listening = false;
      },
      isListening: () => listening,
      getPort: () => (listening ? 19999 : undefined),
    };

    const pool: IUpstreamPool = {
      initialize: async () => {
        poolInitialized = true;
      },
      getAll: () => [],
      getHealthy: () => [new Upstream('u1', '127.0.0.1', 8080)],
      getById: () => undefined,
      recordConnectionStart: () => {},
      recordConnectionEnd: () => {},
      createUpstream: async () => {},
      getByWorkspace: () => undefined,
      removeUpstream: async () => {},
      listByMetadata: () => [],
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

    const healthChecker = {
      startMonitoring: async () => {
        healthStarted = true;
      },
      stopMonitoring: async () => {},
      checkOnce: async () => [],
      isMonitoring: () => healthStarted,
    };

    const orchestrator = new RoutingOrchestrator(
      {
        name: 'sticky-session',
        selectUpstream: (_session, available) =>
          new RoutingDecision(available[0]!, 'sticky-session-new'),
      },
      sessionStore,
      pool
    );

    const service = new MultiplexerService(
      server,
      pool,
      sessionStore,
      new UpstreamHealthMonitor(healthChecker),
      orchestrator
    );

    await service.start(baseConfig);

    assert.equal(listening, true);
    assert.equal(poolInitialized, true);
    assert.equal(healthStarted, true);
    assert.equal(service.isRunning(), true);
    assert.deepEqual(service.getConfig(), baseConfig);

    await service.stop();
    assert.equal(service.isRunning(), false);
    assert.equal(service.getConfig(), null);
  });

  it('wires server handler to routing orchestrator', async () => {
    let routedTarget:
      | { host: string; port: number; upstreamId: string }
      | undefined;

    const server: IMultiplexerServer = {
      listen: async (_port, _host, handler) => {
        routedTarget = await handler(
          { key: '127.0.0.1:54321' } as Session,
          { headers: { host: 'api2.cursor.sh' } } as RoutingContext
        );
      },
      close: async () => {},
      isListening: () => true,
      getPort: () => 19999,
    };

    const upstream = new Upstream('u1', '127.0.0.1', 8080);
    const pool: IUpstreamPool = {
      initialize: async () => {},
      getAll: () => [upstream],
      getHealthy: () => [upstream],
      getById: (id) => (id === 'u1' ? upstream : undefined),
      recordConnectionStart: () => {},
      recordConnectionEnd: () => {},
      createUpstream: async () => {},
      getByWorkspace: () => undefined,
      removeUpstream: async () => {},
      listByMetadata: () => [],
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

    const orchestrator = new RoutingOrchestrator(
      {
        name: 'sticky-session',
        selectUpstream: (_session, available) =>
          new RoutingDecision(available[0]!, 'sticky-session-new'),
      },
      sessionStore,
      pool
    );

    const service = new MultiplexerService(
      server,
      pool,
      sessionStore,
      new UpstreamHealthMonitor({
        startMonitoring: async () => {},
        stopMonitoring: async () => {},
        checkOnce: async () => [],
        isMonitoring: () => false,
      }),
      orchestrator
    );

    await service.start(baseConfig);

    assert.deepEqual(routedTarget, {
      host: '127.0.0.1',
      port: 8080,
      upstreamId: 'u1',
    });

    await service.stop();
  });

  it('clears expired sessions on interval', async () => {
    let cleared = false;

    const server: IMultiplexerServer = {
      listen: async () => {},
      close: async () => {},
      isListening: () => true,
      getPort: () => 19999,
    };

    const pool: IUpstreamPool = {
      initialize: async () => {},
      getAll: () => [],
      getHealthy: () => [new Upstream('u1', '127.0.0.1', 8080)],
      getById: () => undefined,
      recordConnectionStart: () => {},
      recordConnectionEnd: () => {},
      createUpstream: async () => {},
      getByWorkspace: () => undefined,
      removeUpstream: async () => {},
      listByMetadata: () => [],
    };

    const sessionStore: ISessionStore = {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      getByWorkspace: () => undefined,
      setWorkspaceMapping: () => {},
      list: () => [],
      clearExpired: () => {
        cleared = true;
        return 1;
      },
    };

    const service = new MultiplexerService(
      server,
      pool,
      sessionStore,
      new UpstreamHealthMonitor({
        startMonitoring: async () => {},
        stopMonitoring: async () => {},
        checkOnce: async () => [],
        isMonitoring: () => false,
      }),
      new RoutingOrchestrator(
        {
          name: 'sticky-session',
          selectUpstream: (_session, available) =>
            new RoutingDecision(available[0]!, 'sticky-session-new'),
        },
        sessionStore,
        pool
      )
    );

    await service.start({
      ...baseConfig,
      routing: { strategy: 'sticky-session', sessionTimeoutMs: 1 },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(cleared, true);

    await service.stop();
  });
});
