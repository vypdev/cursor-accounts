import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UpstreamPool } from '../../../../proxy/multiplexer/upstreams/upstreamPool';

describe('UpstreamPool', () => {
  it('initializes upstreams from config', async () => {
    const pool = new UpstreamPool();
    await pool.initialize([
      { id: 'u1', host: '127.0.0.1', port: 8080, weight: 2, maxConnections: 5 },
      { id: 'u2', host: '127.0.0.1', port: 8081 },
    ]);

    assert.equal(pool.getAll().length, 2);
    assert.equal(pool.getById('u1')?.weight, 2);
    assert.equal(pool.getById('u1')?.maxConnections, 5);
  });

  it('returns only healthy upstreams that can accept connections', async () => {
    const pool = new UpstreamPool();
    await pool.initialize([
      { id: 'u1', host: '127.0.0.1', port: 8080, maxConnections: 1 },
      { id: 'u2', host: '127.0.0.1', port: 8081 },
    ]);

    pool.getById('u1')!.incrementConnections();
    pool.getById('u2')!.setHealth(false);

    const healthy = pool.getHealthy();
    assert.equal(healthy.length, 0);
  });

  it('tracks connection start and end', async () => {
    const pool = new UpstreamPool();
    await pool.initialize([{ id: 'u1', host: '127.0.0.1', port: 8080 }]);

    pool.recordConnectionStart('u1');
    pool.recordConnectionStart('u1');
    assert.equal(pool.getById('u1')!.connectionCount, 2);

    pool.recordConnectionEnd('u1');
    assert.equal(pool.getById('u1')!.connectionCount, 1);
  });

  it('replaces upstreams on re-initialize', async () => {
    const pool = new UpstreamPool();
    await pool.initialize([{ id: 'u1', host: '127.0.0.1', port: 8080 }]);
    await pool.initialize([{ id: 'u2', host: '127.0.0.1', port: 8081 }]);

    assert.equal(pool.getAll().length, 1);
    assert.equal(pool.getById('u1'), undefined);
    assert.equal(pool.getById('u2')?.port, 8081);
  });
});
