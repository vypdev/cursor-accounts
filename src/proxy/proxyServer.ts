#!/usr/bin/env node
/**
 * Standalone MITM proxy child process entry point.
 * Started via child_process.fork() from ProxyManager.
 *
 * Exposes a localhost HTTP/WebSocket API on `config.apiPort` so any extension
 * host window can consume traffic and control lifecycle without IPC.
 */
import * as path from 'path';
import { CertificateManager } from './certificateManager';
import { PolyglotMitmProxyServer } from './polyglotMitmProxyServer';
import { RequestLogger } from './requestLogger';
import { NullLogger } from './nullLogger';
import type { ProxyTrafficLogger } from './nullLogger';
import type { ProxyServerConfig } from './types';
import { ProxyApiServer } from './api/proxyApiServer';
import type { ProxyApiEvent } from '../application/types/proxyApi';
import { SqliteAgentTrackingDbPool } from '../persistence/betterSqlite/sqliteAgentTrackingDbPool';
import { ProxyAgentTrackingIngress } from './proxyAgentTrackingIngress';
import { SHARED_PROXY_RUNTIME_KEY } from './types';

function parseConfig(): ProxyServerConfig {
  const raw = process.env.CURSOR_ACCOUNTS_PROXY_CONFIG;
  if (!raw) {
    throw new Error('CURSOR_ACCOUNTS_PROXY_CONFIG environment variable is required');
  }
  return JSON.parse(raw) as ProxyServerConfig;
}

function emitTrafficEvent(
  apiServer: ProxyApiServer,
  config: ProxyServerConfig,
  summary: Parameters<NonNullable<import('./types').MitmProxyHandlers['onTraffic']>>[0]
): void {
  const sanitized = {
    ...summary,
    bodyDecoded: undefined,
  };

  const event: ProxyApiEvent = {
    type: 'traffic',
    timestamp: new Date().toISOString(),
    profileId: summary.profileId ?? config.profileId,
    data: sanitized,
  };
  apiServer.broadcast(event);
}

async function main(): Promise<void> {
  const config = parseConfig();
  const startedAt = new Date().toISOString();
  const certDir = path.join(config.storageDir, 'certs');
  const certificateManager = new CertificateManager(certDir);
  const maxBytes = config.maxLogSizeMb * 1024 * 1024;
  const requestLogger: ProxyTrafficLogger = config.developmentMode
    ? new RequestLogger(config.logDir, maxBytes, {
        maxBodyLogBytes: config.maxBodyLogBytes,
        spillLargeBodies: config.spillLargeBodies,
      })
    : new NullLogger();

  const apiServer = new ProxyApiServer();
  let shuttingDown = false;
  let trackingIngress: ProxyAgentTrackingIngress | undefined;

  const profileDbPaths = config.profileDbPaths
    ? new Map(Object.entries(config.profileDbPaths))
    : undefined;
  if (profileDbPaths && profileDbPaths.size > 0 && config.extensionPath) {
    const dbPool = new SqliteAgentTrackingDbPool(
      profileDbPaths,
      config.extensionPath
    );
    trackingIngress = new ProxyAgentTrackingIngress(
      dbPool,
      config.profileId ?? SHARED_PROXY_RUNTIME_KEY
    );
  }

  const userIdMapping = config.userIdToProfileId
    ? new Map(Object.entries(config.userIdToProfileId))
    : undefined;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    if (statsInterval) {
      clearInterval(statsInterval);
    }
    if (diagnosticsInterval) {
      clearInterval(diagnosticsInterval);
    }

    // Stop producing traffic before closing the ingress. The ingress then
    // drains all per-profile queues before SQLite connections are closed.
    await server.stop().catch(() => undefined);
    await trackingIngress?.close().catch(() => undefined);
    await apiServer.stop();
    process.exit(0);
  };

  const server = new PolyglotMitmProxyServer(
    certificateManager,
    requestLogger,
    {
      onTraffic: (summary) => {
        const pendingPersistence = trackingIngress?.enqueue(summary);
        pendingPersistence?.catch(() => undefined);
        emitTrafficEvent(apiServer, config, summary);
      },
    },
    userIdMapping
  );

  server.on('error', (err) => {
    process.stderr.write(`[proxy] ${err.message}\n`);
    apiServer.broadcast({
      type: 'error',
      timestamp: new Date().toISOString(),
      profileId: config.profileId,
      data: { message: err.message, kind: 'PROXY_ERROR' },
    });
  });

  let statsInterval: ReturnType<typeof setInterval> | undefined;
  let diagnosticsInterval: ReturnType<typeof setInterval> | undefined;
  const diagnosticsIntervalMs = config.diagnosticsIntervalMs ?? 30_000;

  const emitDiagnostics = (): void => {
    if (!config.trafficDiagnostics) {
      return;
    }
    const lines = server.formatDiagnosticsLines();
    for (const line of lines) {
      process.stderr.write(`${line}\n`);
    }
    if (lines.length > 0) {
      apiServer.broadcast({
        type: 'diagnostics',
        timestamp: new Date().toISOString(),
        profileId: config.profileId,
        data: { lines },
      });
    }
  };

  const emitStats = (): void => {
    const stats = server.getStatistics();
    const event: ProxyApiEvent = {
      type: 'stats',
      timestamp: new Date().toISOString(),
      profileId: config.profileId,
      data: stats,
    };
    apiServer.broadcast(event);
  };

  try {
    await apiServer.start({
      apiPort: config.apiPort,
      mitmPort: config.port,
      profileId: config.profileId,
      pid: process.pid,
      startedAt,
      getStatistics: () => server.getStatistics(),
      getDiagnosticsLines: () => server.formatDiagnosticsLines(),
      onShutdownRequested: () => {
        void shutdown();
      },
    });

    await server.start(config);
    process.stderr.write(
      `[proxy] MITM listening on 127.0.0.1:${config.port}, API on 127.0.0.1:${config.apiPort}\n`
    );

    statsInterval = setInterval(emitStats, 5000);
    if (config.trafficDiagnostics) {
      emitDiagnostics();
      diagnosticsInterval = setInterval(emitDiagnostics, diagnosticsIntervalMs);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[proxy] startup failed: ${message}\n`);
    await apiServer.stop().catch(() => undefined);
    process.exit(1);
  }
}

void main();
