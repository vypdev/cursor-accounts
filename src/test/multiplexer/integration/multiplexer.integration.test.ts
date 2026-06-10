import assert from 'node:assert/strict';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { createMultiplexerRuntime } from '../../../proxy/multiplexer/factory';
import type { MultiplexerConfig } from '../../../application/types/multiplexerConfig';

let nextPort = 18_000 + (process.pid % 1000);

function allocatePort(): number {
  return nextPort++;
}

const tempRoot = path.join(os.tmpdir(), `mux-integration-${process.pid}`);

describe('Multiplexer MITM integration', () => {
  after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('MITM multiplexer accepts CONNECT tunnels', async () => {
    const routerPort = allocatePort();

    const config: MultiplexerConfig = {
      router: { port: routerPort, host: '127.0.0.1' },
      routing: { strategy: 'workspace-path' },
      health: {
        checkIntervalMs: 60_000,
        timeoutMs: 1_000,
        unhealthyThreshold: 3,
      },
    };

    const runtime = createMultiplexerRuntime(config, {
      storageDir: tempRoot,
      extensionPath: process.cwd(),
      testMode: true,
    });
    await runtime.service.start(config);

    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.connect(routerPort, '127.0.0.1', () => {
        socket.write(
          'CONNECT api2.cursor.sh:443 HTTP/1.1\r\nHost: api2.cursor.sh:443\r\n\r\n'
        );
      });
      socket.once('data', (chunk) => {
        const response = chunk.toString();
        resolve(
          response.includes('200 Connection Established') || response.includes('200 OK')
        );
        socket.end();
      });
      socket.setTimeout(5_000, () => {
        socket.destroy();
        resolve(false);
      });
    });

    await runtime.service.stop();
    assert.equal(connected, true);
  });
});
