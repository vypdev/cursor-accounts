import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RoutingDecision } from '../../../../domain/entities/RoutingDecision';
import { Session } from '../../../../domain/entities/Session';
import { Upstream } from '../../../../domain/entities/Upstream';
import type { IRoutingStrategy } from '../../../../domain/ports/IRoutingStrategy';
import { HybridStrategy } from '../../../../proxy/multiplexer/routing/hybridStrategy';

describe('HybridStrategy', () => {
  const upstreams = [
    new Upstream('u1', '127.0.0.1', 8080),
    new Upstream('u2', '127.0.0.1', 8081),
  ];

  it('uses primary strategy when it succeeds', async () => {
    const primary: IRoutingStrategy = {
      name: 'workspace-path',
      selectUpstream: (_session, available) =>
        new RoutingDecision(available[0]!, 'workspace-path-new'),
    };
    const fallback: IRoutingStrategy = {
      name: 'sticky-session',
      selectUpstream: (_session, available) =>
        new RoutingDecision(available[1]!, 'sticky-session-new'),
    };

    const strategy = new HybridStrategy(primary, fallback);
    const decision = await strategy.selectUpstream(
      new Session('127.0.0.1', 54321),
      upstreams
    );

    assert.equal(decision.upstream.id, 'u1');
    assert.equal(decision.reason, 'hybrid-primary');
  });

  it('falls back when primary throws', async () => {
    const primary: IRoutingStrategy = {
      name: 'workspace-path',
      selectUpstream: () => {
        throw new Error('primary failed');
      },
    };
    const fallback: IRoutingStrategy = {
      name: 'sticky-session',
      selectUpstream: (_session, available) =>
        new RoutingDecision(available[1]!, 'sticky-session-new'),
    };

    const strategy = new HybridStrategy(primary, fallback);
    const decision = await strategy.selectUpstream(
      new Session('127.0.0.1', 54321),
      upstreams
    );

    assert.equal(decision.upstream.id, 'u2');
    assert.equal(decision.reason, 'hybrid-fallback');
  });

  it('preserves metadata from primary decision', async () => {
    const primary: IRoutingStrategy = {
      name: 'workspace-path',
      selectUpstream: (_session, available) =>
        new RoutingDecision(available[0]!, 'workspace-path-new', {
          workspacePath: '/workspace/foo',
        }),
    };
    const fallback: IRoutingStrategy = {
      name: 'sticky-session',
      selectUpstream: (_session, available) =>
        new RoutingDecision(available[0]!, 'sticky-session-new'),
    };

    const strategy = new HybridStrategy(primary, fallback);
    const decision = await strategy.selectUpstream(
      new Session('127.0.0.1', 54321),
      upstreams
    );

    assert.equal(decision.metadata.workspacePath, '/workspace/foo');
  });
});
