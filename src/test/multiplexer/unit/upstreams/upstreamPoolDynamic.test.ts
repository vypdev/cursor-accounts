import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UpstreamPool } from '../../../../proxy/multiplexer/upstreams/upstreamPool';

describe('UpstreamPool dynamic operations', () => {
  it('creates upstream with workspace metadata', async () => {
    const pool = new UpstreamPool();

    await pool.createUpstream({
      id: 'up-1',
      host: '127.0.0.1',
      port: 8100,
      metadata: { workspacePath: '/workspace/a', profileId: 'prof-1' },
    });

    const upstream = pool.getByWorkspace('/workspace/a', 'prof-1');
    assert.equal(upstream?.id, 'up-1');
  });

  it('filters upstreams by metadata', async () => {
    const pool = new UpstreamPool();
    await pool.createUpstream({
      id: 'u1',
      host: '127.0.0.1',
      port: 8100,
      metadata: { profileId: 'p1' },
    });
    await pool.createUpstream({
      id: 'u2',
      host: '127.0.0.1',
      port: 8101,
      metadata: { profileId: 'p2' },
    });

    const filtered = pool.listByMetadata({ profileId: 'p1' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.id, 'u1');
  });

  it('removes upstream and cleans indexes', async () => {
    const pool = new UpstreamPool();
    await pool.createUpstream({
      id: 'up-1',
      host: '127.0.0.1',
      port: 8100,
      metadata: { workspacePath: '/workspace/a' },
    });

    await pool.removeUpstream('up-1');

    assert.equal(pool.getByWorkspace('/workspace/a'), undefined);
    assert.equal(pool.getAll().length, 0);
  });
});
