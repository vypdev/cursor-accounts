import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RoutingDecision } from '../../../../domain/entities/RoutingDecision';
import { Session } from '../../../../domain/entities/Session';
import { Upstream } from '../../../../domain/entities/Upstream';
import { RoutingError } from '../../../../domain/errors/RoutingError';
import type {
  IRoutingStrategy,
  RoutingContext,
} from '../../../../domain/ports/IRoutingStrategy';
import { UpstreamSelector } from '../../../../domain/services/UpstreamSelector';

function mockStrategy(
  impl: IRoutingStrategy['selectUpstream']
): IRoutingStrategy {
  return {
    name: 'sticky-session',
    selectUpstream: impl,
  };
}

describe('UpstreamSelector', () => {
  it('delegates selection to strategy with available upstreams only', async () => {
    const u1 = new Upstream('u1', '127.0.0.1', 8080);
    const u2 = new Upstream('u2', '127.0.0.1', 8081);
    u2.setHealth(false);

    let received: readonly Upstream[] = [];
    const selector = new UpstreamSelector(
      mockStrategy((_, available) => {
        received = available;
        return new RoutingDecision(available[0]!, 'sticky-session-new');
      })
    );

    const decision = await selector.select(new Session('127.0.0.1', 54321), [
      u1,
      u2,
    ]);

    assert.equal(received.length, 1);
    assert.equal(received[0]!.id, 'u1');
    assert.equal(decision.upstream.id, 'u1');
  });

  it('throws RoutingError when no upstreams can accept connections', async () => {
    const u1 = new Upstream('u1', '127.0.0.1', 8080, 1, 1);
    u1.incrementConnections();
    const selector = new UpstreamSelector(
      mockStrategy(() => new RoutingDecision(u1, 'sticky-session-new'))
    );

    await assert.rejects(
      () => selector.select(new Session('127.0.0.1', 54321), [u1]),
      (error: unknown) => {
        assert.ok(error instanceof RoutingError);
        assert.match(error.message, /No available upstreams/);
        return true;
      }
    );
  });

  it('throws RoutingError when strategy selects unavailable upstream', async () => {
    const u1 = new Upstream('u1', '127.0.0.1', 8080);
    const u2 = new Upstream('u2', '127.0.0.1', 8081);
    u2.setHealth(false);

    const selector = new UpstreamSelector(
      mockStrategy(() => new RoutingDecision(u2, 'sticky-session-new'))
    );

    await assert.rejects(
      () => selector.select(new Session('127.0.0.1', 54321), [u1]),
      (error: unknown) => {
        assert.ok(error instanceof RoutingError);
        assert.match(error.message, /unavailable upstream/);
        return true;
      }
    );
  });

  it('passes routing context to strategy', async () => {
    const u1 = new Upstream('u1', '127.0.0.1', 8080);
    let receivedContext: RoutingContext | undefined;

    const selector = new UpstreamSelector(
      mockStrategy((_session, _upstreams, context) => {
        receivedContext = context;
        return new RoutingDecision(u1, 'token-hash');
      })
    );

    const context: RoutingContext = {
      headers: { authorization: 'Bearer token' },
      method: 'POST',
    };

    await selector.select(new Session('127.0.0.1', 54321), [u1], context);
    assert.deepEqual(receivedContext, context);
  });

  it('exposes strategy name', () => {
    const selector = new UpstreamSelector({
      name: 'round-robin',
      selectUpstream: () => new RoutingDecision(new Upstream('u1', '127.0.0.1', 8080), 'round-robin'),
    });
    assert.equal(selector.strategyName, 'round-robin');
  });
});
