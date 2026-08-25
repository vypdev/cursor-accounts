import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { NodeProxyProcess } from '../../proxy/nodeProxyProcess';

describe('NodeProxyProcess', () => {
  function config(dir: string) {
    return {
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
    };
  }

  it('start throws when script path is missing', async () => {
    const process = new NodeProxyProcess('/nonexistent/proxyServer.js', '/tmp');
    await assert.rejects(
      () =>
        process.start({
          ...config('/tmp'),
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
    await proxyProcess.start(config(dir));

    const child = proxyProcess.getChild();
    // With spawn(), there's no IPC channel (unlike fork())
    assert.equal(child?.channel, undefined);

    if (child?.pid != null) {
      await proxyProcess.stop(child.pid, 'SIGKILL');
    }
    proxyProcess.detach();
  });

  it('rejects a second start while the child is running', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-proxy-process-'));
    const scriptPath = path.join(dir, 'idle.js');
    await fs.writeFile(scriptPath, 'setInterval(() => {}, 1000);');

    const proxyProcess = new NodeProxyProcess(scriptPath, dir);
    const runtime = await proxyProcess.start(config(dir));

    try {
      await assert.rejects(
        () => proxyProcess.start(config(dir)),
        /Proxy process is already running/
      );
    } finally {
      await proxyProcess.stop(runtime.pid, 'SIGKILL');
    }
  });

  it('forwards stderr and clears the child reference after natural exit', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-proxy-process-'));
    const scriptPath = path.join(dir, 'exits.js');
    await fs.writeFile(
      scriptPath,
      "process.stderr.write('proxy diagnostic\\n'); setTimeout(() => process.exit(7), 10);"
    );

    const proxyProcess = new NodeProxyProcess(scriptPath, dir);
    const stderr: string[] = [];
    const exitCode = new Promise<number | null>((resolve) => {
      proxyProcess.onExit(resolve);
    });
    proxyProcess.onStderr((chunk) => stderr.push(chunk));

    await proxyProcess.start(config(dir));

    assert.equal(await exitCode, 7);
    assert.deepEqual(stderr, ['proxy diagnostic']);
    assert.equal(proxyProcess.getChild(), null);
  });
});
