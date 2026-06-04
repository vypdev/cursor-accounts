#!/usr/bin/env node
/**
 * Standalone MITM proxy child process entry point.
 * Started via child_process.fork() from ProxyManager.
 */
import * as path from 'path';
import type { ProxyChildMessage, ProxyParentMessage } from './types';
import { CertificateManager } from './certificateManager';
import { MitmProxyServer } from './mitmProxyServer';
import { RequestLogger } from './requestLogger';
import { NullLogger } from './nullLogger';
import type { ProxyTrafficLogger } from './nullLogger';
import type { ProxyServerConfig } from './types';

function send(message: ProxyChildMessage): void {
  if (process.send) {
    process.send(message);
  }
}

function parseConfig(): ProxyServerConfig {
  const raw = process.env.CURSOR_ACCOUNTS_PROXY_CONFIG;
  if (!raw) {
    throw new Error('CURSOR_ACCOUNTS_PROXY_CONFIG environment variable is required');
  }
  return JSON.parse(raw) as ProxyServerConfig;
}

async function main(): Promise<void> {
  const config = parseConfig();
  const certDir = path.join(config.storageDir, 'certs');
  const certificateManager = new CertificateManager(certDir);
  const maxBytes = config.maxLogSizeMb * 1024 * 1024;
  const requestLogger: ProxyTrafficLogger = config.developmentMode
    ? new RequestLogger(config.logDir, maxBytes, {
        maxBodyLogBytes: config.maxBodyLogBytes,
        spillLargeBodies: config.spillLargeBodies,
      })
    : new NullLogger();
  const server = new MitmProxyServer(certificateManager, requestLogger, {
    onTraffic: (summary) => {
      send({
        type: 'traffic',
        summary: {
          ...summary,
          bodyDecoded: undefined,
        },
      });
    },
  });

  server.on('error', (err) => {
    process.stderr.write(`[proxy] ${err.message}\n`);
  });

  let statsInterval: ReturnType<typeof setInterval> | undefined;

  process.on('message', (msg: ProxyParentMessage) => {
    if (msg.type === 'shutdown') {
      void (async () => {
        if (statsInterval) {
          clearInterval(statsInterval);
        }
        await server.stop();
        process.exit(0);
      })();
    } else if (msg.type === 'getStats') {
      send({ type: 'stats', data: server.getStatistics() });
    }
  });

  try {
    await server.start(config);
    send({ type: 'ready', port: config.port });
    statsInterval = setInterval(() => {
      send({ type: 'stats', data: server.getStatistics() });
    }, 5000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send({ type: 'error', message });
    process.exit(1);
  }
}

void main();
