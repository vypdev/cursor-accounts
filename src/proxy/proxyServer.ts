#!/usr/bin/env node
/**
 * Standalone MITM proxy child process entry point.
 * Started via child_process.fork() from ProxyManager.
 *
 * Exposes a localhost HTTP/WebSocket API on `config.apiPort` so any extension
 * host window can consume traffic and control lifecycle without IPC.
 */
import * as path from 'path';
import { z } from 'zod';
import { CertificateManager } from './certificateManager';
import { PolyglotMitmProxyServer } from './polyglotMitmProxyServer';
import { RequestLogger } from './requestLogger';
import { NullLogger } from './nullLogger';
import type { ProxyTrafficLogger } from './nullLogger';
import type { ProxyServerConfig } from './types';
import { ProxyApiServer } from './api/proxyApiServer';
import { SqliteAgentTrackingDbPool } from '../persistence/betterSqlite/sqliteAgentTrackingDbPool';
import { ProxyAgentTrackingIngress } from './proxyAgentTrackingIngress';
import { ProxyServerRuntime } from '../application/proxyServerRuntime';

const proxyServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65_535),
  apiPort: z.number().int().min(1).max(65_535),
  apiToken: z.string().min(32).optional(),
  profileId: z.string().min(1),
  storageDir: z.string().min(1),
  logDir: z.string().min(1),
  maxLogSizeMb: z.number().finite().positive(),
  maxBodyLogBytes: z.number().int().positive(),
  spillLargeBodies: z.boolean(),
  developmentMode: z.boolean(),
  trafficDiagnostics: z.boolean(),
  diagnosticsIntervalMs: z.number().int().positive(),
  userIdToProfileId: z.record(z.string(), z.string()).optional(),
  profileDbPaths: z.record(z.string(), z.string()).optional(),
  extensionPath: z.string().min(1).optional(),
});

export function parseProxyServerConfig(raw: string): ProxyServerConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `CURSOR_ACCOUNTS_PROXY_CONFIG is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const result = proxyServerConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `CURSOR_ACCOUNTS_PROXY_CONFIG is invalid: ${result.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`
    );
  }
  return result.data;
}

function parseConfig(): ProxyServerConfig {
  const raw = process.env.CURSOR_ACCOUNTS_PROXY_CONFIG;
  if (!raw) {
    throw new Error('CURSOR_ACCOUNTS_PROXY_CONFIG environment variable is required');
  }
  return parseProxyServerConfig(raw);
}

export function createProxyServerRuntime(
  config: ProxyServerConfig,
  writeStderr: (message: string) => void = (message) => {
    process.stderr.write(message);
  },
  now: () => string = () => new Date().toISOString(),
  onShutdownRequested?: (shutdown: Promise<void>) => void
): ProxyServerRuntime {
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
      config.profileId
    );
  }

  const userIdMapping = config.userIdToProfileId
    ? new Map(Object.entries(config.userIdToProfileId))
    : undefined;

  const runtimeRef: { current?: ProxyServerRuntime } = {};
  const server = new PolyglotMitmProxyServer(
    certificateManager,
    requestLogger,
    {
      onTraffic: (summary) => {
        runtimeRef.current?.emitTraffic(config, summary);
      },
    },
    userIdMapping
  );

  const runtime = new ProxyServerRuntime({
    apiServer,
    proxyServer: server,
    trackingIngress,
    writeStderr,
    now,
    onShutdownRequested,
  });
  runtimeRef.current = runtime;
  return runtime;
}

async function main(): Promise<void> {
  const config = parseConfig();
  const exitAfterShutdown = (shutdown: Promise<void>): void => {
    void shutdown.then(
      () => process.exit(0),
      () => process.exit(0)
    );
  };
  const runtime = createProxyServerRuntime(
    config,
    undefined,
    undefined,
    exitAfterShutdown
  );

  const handleTerminationSignal = (): void => {
    exitAfterShutdown(runtime.shutdown());
  };

  // The lifecycle coordinators normally request shutdown through the API, but
  // supervisors can terminate the child directly when the API is unavailable.
  // Keep that fallback graceful so queued tracking writes are drained first.
  process.once('SIGTERM', handleTerminationSignal);
  process.once('SIGINT', handleTerminationSignal);

  try {
    await runtime.start(config, process.pid);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[proxy] startup failed: ${message}\n`);
    await runtime.shutdown();
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
