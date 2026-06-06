import assert from 'node:assert/strict';
import * as http from 'node:http';
import * as net from 'node:net';
import { describe, it, after } from 'node:test';
import { createMultiplexerRuntime } from '../../../proxy/multiplexer/factory';
import type { MultiplexerConfig } from '../../../application/types/multiplexerConfig';

async function startMockUpstream(port: number): Promise<http.Server> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  server.on('connect', (req, clientSocket, head) => {
    const targetPort = Number.parseInt(req.url?.split(':')[1] ?? '443', 10);
    const upstream = net.connect(targetPort, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) {
        upstream.write(head);
      }
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.end());
  });
  return server;
}

let nextPort = 18_000 + (process.pid % 1000);

function allocatePort(): number {
  return nextPort++;
}

describe('Multiplexer integration', () => {
  const upstreamServers: http.Server[] = [];

  after(async () => {
    for (const server of upstreamServers) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('routes CONNECT tunnels to an upstream', async () => {
    const routerPort = allocatePort();
    const upstreamPort = allocatePort();
    upstreamServers.push(await startMockUpstream(upstreamPort));

    const config: MultiplexerConfig = {
      router: { port: routerPort, host: '127.0.0.1' },
      upstreams: [{ id: 'u1', host: '127.0.0.1', port: upstreamPort }],
      routing: { strategy: 'sticky-session' },
      health: {
        checkIntervalMs: 60_000,
        timeoutMs: 1_000,
        unhealthyThreshold: 3,
      },
    };

    const runtime = createMultiplexerRuntime(config);
    await runtime.service.start(config);

    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.connect(routerPort, '127.0.0.1', () => {
        socket.write('CONNECT api2.cursor.sh:443 HTTP/1.1\r\nHost: api2.cursor.sh:443\r\n\r\n');
      });
      socket.once('data', (chunk) => {
        resolve(chunk.toString().includes('200 Connection Established'));
        socket.end();
      });
      socket.setTimeout(2_000, () => {
        socket.destroy();
        resolve(false);
      });
    });

    await runtime.service.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(connected, true);
  });
});
