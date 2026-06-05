import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { CertificateManager } from '../proxy/certificateManager';
import { PolyglotMitmProxyServer as MitmProxyServer } from '../proxy/polyglotMitmProxyServer';
import { RequestLogger } from '../proxy/requestLogger';
import { isPortAvailable } from '../proxy/portUtils';

async function reservePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 20; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error('No available port for test');
}

describe('MitmProxyServer forwarding', () => {
  let tempDir: string;
  let backendServer: http.Server | undefined;
  let proxyServer: MitmProxyServer | undefined;
  let backendPort = 0;
  let proxyPort = 0;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-mitm-')
    );
    backendPort = await reservePort(19000);
    proxyPort = await reservePort(19100);
  });

  afterEach(async () => {
    await proxyServer?.stop();
    proxyServer = undefined;
    await new Promise<void>((resolve) => {
      if (!backendServer) {
        resolve();
        return;
      }
      backendServer.close(() => resolve());
    });
    backendServer = undefined;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it(
    'forwards HTTP POST with Connection: close to upstream',
    { timeout: 20_000 },
    async () => {
    const received: Array<{ method?: string; body: string }> = [];

    backendServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        received.push({ method: req.method, body });
        const payload = `ok:${body}`;
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(payload),
          Connection: 'close',
        });
        res.end(payload);
      });
    });

    await new Promise<void>((resolve, reject) => {
      backendServer!.once('error', reject);
      backendServer!.listen(backendPort, '127.0.0.1', () => resolve());
    });

    const certManager = new CertificateManager(path.join(tempDir, 'certs'));
    const requestLogger = new RequestLogger(path.join(tempDir, 'logs'), 1024 * 1024);
    proxyServer = new MitmProxyServer(certManager, requestLogger);
    await proxyServer.start({
      port: proxyPort,
      storageDir: tempDir,
      logDir: path.join(tempDir, 'logs'),
      maxLogSizeMb: 1,
      maxBodyLogBytes: 4 * 1024 * 1024,
      spillLargeBodies: true,
      developmentMode: true,
      trafficDiagnostics: false,
      diagnosticsIntervalMs: 30_000,
    });

    const responseBody = await new Promise<string>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: proxyPort,
          method: 'POST',
          path: `http://127.0.0.1:${backendPort}/echo`,
          headers: {
            Host: `127.0.0.1:${backendPort}`,
            'Content-Type': 'text/plain',
            'Content-Length': '5',
            Connection: 'close',
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        }
      );
      req.on('error', reject);
      req.end('hello');
    });

    assert.equal(responseBody, 'ok:hello');
    assert.equal(received.length, 1);
    assert.equal(received[0]?.method, 'POST');
    assert.equal(received[0]?.body, 'hello');
    }
  );
});
