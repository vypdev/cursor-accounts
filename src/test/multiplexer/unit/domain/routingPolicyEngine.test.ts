import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RoutingDecision } from '../../../../domain/entities/RoutingDecision';
import { Session } from '../../../../domain/entities/Session';
import { Upstream } from '../../../../domain/entities/Upstream';
import type { IRoutingStrategy } from '../../../../domain/ports/IRoutingStrategy';
import { RoutingPolicyEngine } from '../../../../domain/services/RoutingPolicyEngine';
import { InMemorySessionStore } from '../../../../proxy/multiplexer/storage/inMemorySessionStore';
import { StickySessionStrategy } from '../../../../proxy/multiplexer/routing/stickySessionStrategy';
import { RoundRobinStrategy } from '../../../../proxy/multiplexer/routing/roundRobinStrategy';

describe('RoutingPolicyEngine', () => {
  it('routes via primary strategy and persists session binding', async () => {
    const store = new InMemorySessionStore();
    const engine = new RoutingPolicyEngine(
      new StickySessionStrategy(store),
      store
    );
    const session = new Session('127.0.0.1', 54321);
    const upstreams = [new Upstream('u1', '127.0.0.1', 8080)];

    const decision = await engine.route(session, upstreams);

    assert.equal(decision.upstream.id, 'u1');
    assert.equal(store.get(session)?.upstreamId, 'u1');
  });

  it('persists workspace mapping when decision includes workspace path', async () => {
    const store = new InMemorySessionStore();
    const primary: IRoutingStrategy = {
      name: 'workspace-path',
      selectUpstream: (_session, available) =>
        new RoutingDecision(available[0]!, 'workspace-path-new', {
          workspacePath: '/Users/dev/project-a',
        }),
    };
    const engine = new RoutingPolicyEngine(primary, store);
    const session = new Session('127.0.0.1', 54321);

    await engine.route(session, [new Upstream('u1', '127.0.0.1', 8080)]);

    assert.equal(
      store.getByWorkspace('/Users/dev/project-a')?.upstreamId,
      'u1'
    );
  });

  it('falls back to secondary strategy when primary fails', async () => {
    const store = new InMemorySessionStore();
    const failing: IRoutingStrategy = {
      name: 'workspace-path',
      selectUpstream: () => {
        throw new Error('primary failed');
      },
    };
    const engine = new RoutingPolicyEngine(
      failing,
      store,
      new RoundRobinStrategy()
    );
    const session = new Session('127.0.0.1', 54321);
    const upstreams = [
      new Upstream('u1', '127.0.0.1', 8080),
      new Upstream('u2', '127.0.0.1', 8081),
    ];

    const decision = await engine.route(session, upstreams);
    assert.equal(decision.upstream.id, 'u1');
    assert.equal(decision.reason, 'round-robin');
  });

  it('throws when primary fails and no fallback configured', async () => {
    const store = new InMemorySessionStore();
    const failing: IRoutingStrategy = {
      name: 'token-hash',
      selectUpstream: () => {
        throw new Error('no token');
      },
    };
    const engine = new RoutingPolicyEngine(failing, store);
    const session = new Session('127.0.0.1', 54321);

    await assert.rejects(
      () => engine.route(session, [new Upstream('u1', '127.0.0.1', 8080)]),
      /Routing failed for session/
    );
  });
});
