import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Upstream } from '../../../../domain/entities/Upstream';
import { Session } from '../../../../domain/entities/Session';
import { RoundRobinStrategy } from '../../../../proxy/multiplexer/routing/roundRobinStrategy';

describe('RoundRobinStrategy', () => {
  it('distributes new sessions across upstreams', () => {
    const strategy = new RoundRobinStrategy();
    const upstreams = [
      new Upstream('u1', '127.0.0.1', 8080),
      new Upstream('u2', '127.0.0.1', 8081),
      new Upstream('u3', '127.0.0.1', 8082),
    ];

    const ids = [1, 2, 3].map((port) =>
      strategy.selectUpstream(new Session('127.0.0.1', port), upstreams).upstream.id
    );

    assert.deepEqual(ids, ['u1', 'u2', 'u3']);
  });
});
