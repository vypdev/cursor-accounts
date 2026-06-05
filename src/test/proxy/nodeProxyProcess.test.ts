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

  it('delivers IPC messages when handlers are registered before start', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-proxy-process-'));
    const scriptPath = path.join(dir, 'ipc-echo.js');
    await fs.writeFile(
      scriptPath,
      `
        process.send({ type: 'ready', port: 8080 });
        process.send({
          type: 'traffic',
          summary: {
            timestamp: new Date().toISOString(),
            kind: 'response',
            url: 'https://api2.cursor.sh/agent.v1.AgentService/RunSSE',
            host: 'api2.cursor.sh',
            isLiveTokenUpdate: true,
            liveTokenData: { accumulatedTokens: 42, latestDelta: 7 },
            insights: { agent: { streamingTokens: 42, usageEvent: 'token_delta' } },
          },
        });
      `
    );

    const proxyProcess = new NodeProxyProcess(scriptPath, dir);
    const messages: unknown[] = [];
    proxyProcess.onMessage((msg) => {
      messages.push(msg);
    });

    await proxyProcess.start({
      port: 8080,
      storageDir: dir,
      logDir: path.join(dir, 'logs'),
      maxLogSizeMb: 50,
      maxBodyLogBytes: 1024,
      spillLargeBodies: false,
      developmentMode: false,
      trafficDiagnostics: false,
      diagnosticsIntervalMs: 30_000,
    });

    await new Promise((resolve) => setTimeout(resolve, 250));

    const traffic = messages.find(
      (msg) =>
        typeof msg === 'object' &&
        msg != null &&
        (msg as { type?: string }).type === 'traffic'
    ) as { summary?: { isLiveTokenUpdate?: boolean } } | undefined;

    assert.ok(traffic, 'expected traffic IPC message');
    assert.equal(traffic.summary?.isLiveTokenUpdate, true);

    const child = proxyProcess.getChild();
    if (child?.pid != null) {
      await proxyProcess.stop(child.pid, 'SIGKILL');
    }
    proxyProcess.detach();
  });
});
