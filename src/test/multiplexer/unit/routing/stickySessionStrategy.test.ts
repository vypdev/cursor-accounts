import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Upstream } from '../../../../domain/entities/Upstream';
import { Session } from '../../../../domain/entities/Session';
import { InMemorySessionStore } from '../../../../proxy/multiplexer/storage/inMemorySessionStore';
import { StickySessionStrategy } from '../../../../proxy/multiplexer/routing/stickySessionStrategy';

describe('StickySessionStrategy', () => {
  it('assigns and reuses upstream for same session', () => {
    const store = new InMemorySessionStore();
    const strategy = new StickySessionStrategy(store);
    const session = new Session('127.0.0.1', 54321);
    const upstreams = [
      new Upstream('u1', '127.0.0.1', 8080),
      new Upstream('u2', '127.0.0.1', 8081),
    ];

    const first = strategy.selectUpstream(session, upstreams);
    const second = strategy.selectUpstream(session, upstreams);

    assert.equal(first.upstream.id, 'u1');
    assert.equal(second.upstream.id, 'u1');
    assert.equal(second.reason, 'sticky-session-hit');
  });

  it('distributes new sessions via round-robin', () => {
    const store = new InMemorySessionStore();
    const strategy = new StickySessionStrategy(store);
    const upstreams = [
      new Upstream('u1', '127.0.0.1', 8080),
      new Upstream('u2', '127.0.0.1', 8081),
      new Upstream('u3', '127.0.0.1', 8082),
    ];

    const ids = [54321, 54322, 54323].map((port) =>
      strategy.selectUpstream(new Session('127.0.0.1', port), upstreams).upstream.id
    );

    assert.deepEqual(ids, ['u1', 'u2', 'u3']);
  });

  it('reassigns when original upstream is unavailable', () => {
    const store = new InMemorySessionStore();
    const strategy = new StickySessionStrategy(store);
    const session = new Session('127.0.0.1', 54321);
    const u1 = new Upstream('u1', '127.0.0.1', 8080);
    const u2 = new Upstream('u2', '127.0.0.1', 8081);

    strategy.selectUpstream(session, [u1, u2]);
    u1.setHealth(false);

    const decision = strategy.selectUpstream(session, [u1, u2]);
    assert.equal(decision.upstream.id, 'u2');
    assert.equal(decision.reason, 'sticky-session-new');
  });
});
