import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { NodeProxyProcess } from '../../proxy/nodeProxyProcess';

describe('NodeProxyProcess', () => {
  it('start throws when script path is missing', async () => {
    const process = new NodeProxyProcess('/nonexistent/proxyServer.js', '/tmp');
    await assert.rejects(
      () =>
        process.start({
          port: 8080,
          apiPort: 18080,
          profileId: 'test-profile',
          storageDir: '/tmp',
          logDir: '/tmp/logs',
          maxLogSizeMb: 50,
          maxBodyLogBytes: 1024,
          spillLargeBodies: false,
          developmentMode: false,
          trafficDiagnostics: false,
          diagnosticsIntervalMs: 30_000,
        }),
      /not found/
    );
  });

  it('isAlive returns false for non-running pid', () => {
    const process = new NodeProxyProcess('/tmp/proxyServer.js', '/tmp');
    assert.equal(process.isAlive(999_999_999), false);
  });

  it('spawns child without IPC channel', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-proxy-process-'));
    const scriptPath = path.join(dir, 'idle.js');
    await fs.writeFile(scriptPath, 'setInterval(() => {}, 1000);');

    const proxyProcess = new NodeProxyProcess(scriptPath, dir);
    await proxyProcess.start({
      port: 8080,
      apiPort: 18080,
      profileId: 'test-profile',
      storageDir: dir,
      logDir: path.join(dir, 'logs'),
      maxLogSizeMb: 50,
      maxBodyLogBytes: 1024,
      spillLargeBodies: false,
      developmentMode: false,
      trafficDiagnostics: false,
      diagnosticsIntervalMs: 30_000,
    });

    const child = proxyProcess.getChild();
    // With spawn(), there's no IPC channel (unlike fork())
    assert.equal(child?.channel, undefined);

    if (child?.pid != null) {
      await proxyProcess.stop(child.pid, 'SIGKILL');
    }
    proxyProcess.detach();
  });
});
