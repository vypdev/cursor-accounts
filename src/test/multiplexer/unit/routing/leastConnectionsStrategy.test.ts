import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Upstream } from '../../../../domain/entities/Upstream';
import { Session } from '../../../../domain/entities/Session';
import { LeastConnectionsStrategy } from '../../../../proxy/multiplexer/routing/leastConnectionsStrategy';

describe('LeastConnectionsStrategy', () => {
  it('selects upstream with fewest active connections', () => {
    const strategy = new LeastConnectionsStrategy();
    const u1 = new Upstream('u1', '127.0.0.1', 8080);
    const u2 = new Upstream('u2', '127.0.0.1', 8081);
    u1.incrementConnections();
    u1.incrementConnections();

    const decision = strategy.selectUpstream(
      new Session('127.0.0.1', 12345),
      [u1, u2]
    );

    assert.equal(decision.upstream.id, 'u2');
  });
});
