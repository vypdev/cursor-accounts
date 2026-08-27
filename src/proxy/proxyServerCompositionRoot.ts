import * as path from 'path';
import { CertificateManager } from './certificateManager';
import { MitmCertificateDirectory } from './mitmCertificateDirectory';
import { PolyglotMitmProxyServer } from './polyglotMitmProxyServer';
import { RequestLogger } from './requestLogger';
import { NullLogger } from './nullLogger';
import type { ProxyTrafficLogger } from './nullLogger';
import type { ProxyServerConfig } from './types';
import { ProxyApiServer } from './api/proxyApiServer';
import { SqliteAgentTrackingDbPool } from '../persistence/betterSqlite/sqliteAgentTrackingDbPool';
import { ProxyAgentTrackingIngress } from './proxyAgentTrackingIngress';
import { ProxyServerRuntime } from '../application/proxyServerRuntime';

/**
 * Composes the standalone proxy process infrastructure around the application
 * runtime. This is intentionally kept outside the executable entry point so
 * construction can be characterized without starting a child process.
 */
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
  const certificateDirectory = new MitmCertificateDirectory(
    certDir,
    certificateManager
  );
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
    certificateDirectory,
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
