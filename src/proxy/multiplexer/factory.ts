import * as path from 'path';
import { MetricsAggregator } from '../../application/services/metricsAggregator';
import { MultiplexerService } from '../../application/services/multiplexerService';
import type { MultiplexerConfig } from '../../application/types/multiplexerConfig';
import type { IProfileManager } from '../../domain/ports/IProfileManager';
import { CertificateManager } from '../certificateManager';
import { NullLogger } from '../nullLogger';
import { getMultiplexerLogDir } from './multiplexerPaths';
import { ManagementApiServer } from './api/managementApiServer';
import { MultiplexerMitmServer } from './multiplexerMitmServer';
import { MultiplexerMetricsCollector } from './metrics/multiplexerMetricsCollector';
import { MultiplexerEventLogger } from './multiplexerEventLogger';
import { InMemorySessionStore } from './storage/inMemorySessionStore';
import { UpstreamWorkerManager } from './upstreamWorkerManager';
import { UpstreamWorkerRegistry } from './upstreams/upstreamWorkerRegistry';

export interface MultiplexerRuntime {
  service: MultiplexerService;
  metricsAggregator: MetricsAggregator;
  upstreamWorkerManager: UpstreamWorkerManager;
  workerRegistry: UpstreamWorkerRegistry;
  sessionStore: InMemorySessionStore;
  managementApi: ManagementApiServer;
}

export interface MultiplexerRuntimeOptions {
  profileManager?: IProfileManager;
  eventLogger?: MultiplexerEventLogger;
  storageDir: string;
  extensionPath: string;
  testMode?: boolean;
}

/** Builds a fully wired multiplexor runtime from configuration. */
export function createMultiplexerRuntime(
  config: MultiplexerConfig,
  options: MultiplexerRuntimeOptions
): MultiplexerRuntime {
  const sessionStore = new InMemorySessionStore();
  const workerRegistry = new UpstreamWorkerRegistry();
  const eventLogger = options.eventLogger ?? new MultiplexerEventLogger();

  const metrics = new MultiplexerMetricsCollector();
  const metricsAggregator = new MetricsAggregator(
    metrics,
    workerRegistry,
    config.routing.strategy,
    config.router.port
  );

  const certManager = new CertificateManager(path.join(options.storageDir, 'certs'));
  const server = new MultiplexerMitmServer(certManager, new NullLogger());
  server.setProfileManager(options.profileManager);

  const upstreamWorkerManager = new UpstreamWorkerManager(workerRegistry, {
    profileManager: options.profileManager,
    eventLogger,
    extensionPath: options.extensionPath,
    testMode: options.testMode,
  });
  server.setUpstreamNotifier(upstreamWorkerManager);

  let activeConfig: MultiplexerConfig | null = null;

  const managementApi = new ManagementApiServer(
    workerRegistry,
    upstreamWorkerManager,
    metricsAggregator,
    sessionStore,
    () => activeConfig,
    eventLogger
  );
  server.setManagementApi(managementApi);

  const service = new MultiplexerService(
    server,
    upstreamWorkerManager,
    sessionStore,
    metricsAggregator,
    {
      storageDir: options.storageDir,
      logDir: getMultiplexerLogDir(),
      extensionPath: options.extensionPath,
    },
    {
      onStarted: (startedConfig) => {
        activeConfig = startedConfig;
        managementApi.notifyConfigChanged();
        managementApi.notifyStatusChanged();
      },
      onStopped: () => {
        activeConfig = null;
      },
    }
  );

  return {
    service,
    metricsAggregator,
    upstreamWorkerManager,
    workerRegistry,
    sessionStore,
    managementApi,
  };
}
