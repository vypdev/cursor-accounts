import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RoutingDecision } from '../../../../domain/entities/RoutingDecision';
import { Session } from '../../../../domain/entities/Session';
import { Upstream } from '../../../../domain/entities/Upstream';
import type { IMultiplexerMetrics } from '../../../../domain/ports/IMultiplexerMetrics';
import type { IUpstreamPool } from '../../../../domain/ports/IUpstreamPool';
import { RoutingOrchestrator } from '../../../../application/services/routingOrchestrator';
import { InMemorySessionStore } from '../../../../proxy/multiplexer/storage/inMemorySessionStore';
import { StickySessionStrategy } from '../../../../proxy/multiplexer/routing/stickySessionStrategy';
import { UpstreamPool } from '../../../../proxy/multiplexer/upstreams/upstreamPool';

async function createPool(upstreams: Upstream[]): Promise<IUpstreamPool> {
  const pool = new UpstreamPool();
  await pool.initialize(
    upstreams.map((u) => ({
      id: u.id,
      host: u.host,
      port: u.port,
    }))
  );
  for (const upstream of upstreams) {
    pool.getById(upstream.id)!.setHealth(upstream.canAcceptConnection());
  }
  return pool;
}

describe('RoutingOrchestrator', () => {
  it('routes to healthy upstream and records connection start', async () => {
    const store = new InMemorySessionStore();
    const pool = await createPool([new Upstream('u1', '127.0.0.1', 8080)]);
    const metrics: IMultiplexerMetrics = {
      recordRouting: () => {},
      recordConnectionStart: () => {},
      recordConnectionEnd: () => {},
      setActiveSessions: () => {},
      getSnapshot: () => ({
        totalRequests: 0,
        activeSessions: 0,
        upstreamMetrics: {},
        routingByReason: {},
      }),
      reset: () => {},
    };

    const orchestrator = new RoutingOrchestrator(
      new StickySessionStrategy(store),
      store,
      pool,
      metrics
    );

    const decision = await orchestrator.route(new Session('127.0.0.1', 54321));
    assert.equal(decision.upstream.id, 'u1');
    assert.equal(pool.getById('u1')!.connectionCount, 1);
  });

  it('emits routing events to listeners', async () => {
    const store = new InMemorySessionStore();
    const pool = await createPool([new Upstream('u1', '127.0.0.1', 8080)]);
    const orchestrator = new RoutingOrchestrator(
      new StickySessionStrategy(store),
      store,
      pool
    );

    const events: string[] = [];
    orchestrator.onRouting((event) => {
      events.push(event.upstreamId);
    });

    await orchestrator.route(new Session('127.0.0.1', 54321));
    assert.deepEqual(events, ['u1']);
  });

  it('releaseConnection decrements pool connection count', async () => {
    const store = new InMemorySessionStore();
    const pool = await createPool([new Upstream('u1', '127.0.0.1', 8080)]);
    const orchestrator = new RoutingOrchestrator(
      new StickySessionStrategy(store),
      store,
      pool
    );

    await orchestrator.route(new Session('127.0.0.1', 54321));
    orchestrator.releaseConnection('u1');
    assert.equal(pool.getById('u1')!.connectionCount, 0);
  });

  it('uses only healthy upstreams from pool', async () => {
    const store = new InMemorySessionStore();
    const u1 = new Upstream('u1', '127.0.0.1', 8080);
    u1.setHealth(false);
    const u2 = new Upstream('u2', '127.0.0.1', 8081);
    const pool = await createPool([u1, u2]);

    const orchestrator = new RoutingOrchestrator(
      new StickySessionStrategy(store),
      store,
      pool
    );

    const decision = await orchestrator.route(new Session('127.0.0.1', 54321));
    assert.equal(decision.upstream.id, 'u2');
  });

  it('includes workspace path in routing event metadata', async () => {
    const store = new InMemorySessionStore();
    const pool = await createPool([new Upstream('u1', '127.0.0.1', 8080)]);
    const strategy = {
      name: 'workspace-path' as const,
      selectUpstream: (_session: Session, available: readonly Upstream[]) =>
        new RoutingDecision(available[0]!, 'workspace-path-new', {
          workspacePath: '/workspace/foo',
        }),
    };
    const orchestrator = new RoutingOrchestrator(strategy, store, pool);

    let workspacePath: string | undefined;
    orchestrator.onRouting((event) => {
      workspacePath = event.workspacePath;
    });

    await orchestrator.route(new Session('127.0.0.1', 54321));
    assert.equal(workspacePath, '/workspace/foo');
  });
});
