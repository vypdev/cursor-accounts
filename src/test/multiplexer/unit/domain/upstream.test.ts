import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Upstream } from '../../../../domain/entities/Upstream';

describe('Upstream entity', () => {
  it('accepts connections when healthy and below max', () => {
    const upstream = new Upstream('u1', '127.0.0.1', 8080, 1, 2);
    assert.equal(upstream.canAcceptConnection(), true);
  });

  it('rejects connections at max capacity', () => {
    const upstream = new Upstream('u1', '127.0.0.1', 8080, 1, 2);
    upstream.incrementConnections();
    upstream.incrementConnections();
    assert.equal(upstream.canAcceptConnection(), false);
  });

  it('rejects connections when unhealthy', () => {
    const upstream = new Upstream('u1', '127.0.0.1', 8080);
    upstream.setHealth(false);
    assert.equal(upstream.canAcceptConnection(), false);
  });

  it('calculates current load', () => {
    const upstream = new Upstream('u1', '127.0.0.1', 8080, 1, 10);
    upstream.incrementConnections();
    upstream.incrementConnections();
    upstream.incrementConnections();
    assert.equal(upstream.currentLoad, 0.3);
  });

  it('validates port and weight', () => {
    assert.throws(() => new Upstream('u1', '127.0.0.1', 70000));
    assert.throws(() => new Upstream('u1', '127.0.0.1', 8080, -1));
  });
});
