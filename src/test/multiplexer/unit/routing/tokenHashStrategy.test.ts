import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Upstream } from '../../../../domain/entities/Upstream';
import { Session } from '../../../../domain/entities/Session';
import { TokenHashStrategy } from '../../../../proxy/multiplexer/routing/tokenHashStrategy';

describe('TokenHashStrategy', () => {
  it('routes same authorization token to same upstream', () => {
    const strategy = new TokenHashStrategy();
    const sessionA = new Session('127.0.0.1', 11111);
    const sessionB = new Session('127.0.0.1', 22222);
    const upstreams = [
      new Upstream('u1', '127.0.0.1', 8080),
      new Upstream('u2', '127.0.0.1', 8081),
      new Upstream('u3', '127.0.0.1', 8082),
    ];
    const context = { headers: { authorization: 'Bearer token-abc' } };

    const a = strategy.selectUpstream(sessionA, upstreams, context);
    const b = strategy.selectUpstream(sessionB, upstreams, context);

    assert.equal(a.upstream.id, b.upstream.id);
  });
});
