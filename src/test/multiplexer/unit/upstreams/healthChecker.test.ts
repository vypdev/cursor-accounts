import assert from 'node:assert/strict';
import * as http from 'node:http';
import { describe, it, after } from 'node:test';
import { UpstreamPool } from '../../../../proxy/multiplexer/upstreams/upstreamPool';
import { HealthChecker } from '../../../../proxy/multiplexer/upstreams/healthChecker';

async function listen(server: http.Server, port: number): Promise<void> {
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
}

describe('HealthChecker', () => {
  const servers: http.Server[] = [];

  after(async () => {
    for (const server of servers) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('marks upstream healthy when TCP connect succeeds', async () => {
    const port = 19100;
    const server = http.createServer();
    servers.push(server);
    await listen(server, port);

    const pool = new UpstreamPool();
    await pool.initialize([{ id: 'u1', host: '127.0.0.1', port }]);

    const checker = new HealthChecker({ timeoutMs: 1_000, unhealthyThreshold: 2 });
    const statuses = await checker.checkOnce(pool);

    assert.equal(statuses[0]?.state, 'healthy');
    assert.equal(pool.getById('u1')!.healthy, true);
  });

  it('marks upstream unhealthy after repeated probe failures', async () => {
    const pool = new UpstreamPool();
    await pool.initialize([{ id: 'u1', host: '127.0.0.1', port: 19998 }]);

    const checker = new HealthChecker({
      timeoutMs: 100,
      unhealthyThreshold: 2,
    });

    await checker.checkOnce(pool);
    const second = await checker.checkOnce(pool);

    assert.equal(second[0]?.state, 'unhealthy');
    assert.equal(pool.getById('u1')!.healthy, false);
  });

  it('starts and stops monitoring interval', async () => {
    const port = 19101;
    const server = http.createServer();
    servers.push(server);
    await listen(server, port);

    const pool = new UpstreamPool();
    await pool.initialize([{ id: 'u1', host: '127.0.0.1', port }]);
    const checker = new HealthChecker({ timeoutMs: 500, unhealthyThreshold: 3 });

    await checker.startMonitoring(pool, 30_000);
    assert.equal(checker.isMonitoring(), true);

    await checker.stopMonitoring();
    assert.equal(checker.isMonitoring(), false);
  });
});
