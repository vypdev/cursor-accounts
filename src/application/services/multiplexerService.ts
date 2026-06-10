import * as path from 'path';
import type { IMultiplexerServer } from '../../domain/ports/IMultiplexerServer';
import type { ISessionStore } from '../../domain/ports/ISessionStore';
import type { ProxyServerConfig } from '../types/proxyConfig';
import type { MultiplexerConfig } from '../types/multiplexerConfig';
import { CertificateManager } from '../../proxy/certificateManager';
import { MetricsAggregator } from './metricsAggregator';
import type { UpstreamWorkerManager } from '../../proxy/multiplexer/upstreamWorkerManager';

export interface MultiplexerServiceLifecycleHooks {
  onStarted?: (config: MultiplexerConfig) => void;
  onStopped?: () => void;
}

export interface MultiplexerServiceDependencies {
  storageDir: string;
  logDir: string;
  extensionPath: string;
}

/**
 * Application service: multiplexor MITM lifecycle.
 */
export class MultiplexerService {
  private config: MultiplexerConfig | null = null;
  private sessionCleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly server: IMultiplexerServer,
    private readonly upstreamWorkerManager: UpstreamWorkerManager,
    private readonly sessionStore: ISessionStore,
    private readonly metricsAggregator: MetricsAggregator,
    private readonly deps: MultiplexerServiceDependencies,
    private readonly lifecycleHooks?: MultiplexerServiceLifecycleHooks
  ) {}

  async start(config: MultiplexerConfig): Promise<void> {
    this.config = config;

    const certManager = new CertificateManager(
      path.join(this.deps.storageDir, 'certs')
    );
    await certManager.ensureCaCertificate();

    const proxyConfig = this.buildProxyServerConfig(config);
    await this.server.start(proxyConfig);

    const timeoutMs = config.routing.sessionTimeoutMs ?? 3_600_000;
    this.sessionCleanupTimer = setInterval(() => {
      const before = new Date(Date.now() - timeoutMs);
      this.sessionStore.clearExpired(before);
    }, Math.min(timeoutMs, 60_000));

    this.lifecycleHooks?.onStarted?.(config);
  }

  async stop(): Promise<void> {
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer);
      this.sessionCleanupTimer = undefined;
    }

    await this.upstreamWorkerManager.stopAll();
    await this.server.stop();
    this.config = null;
    this.lifecycleHooks?.onStopped?.();
  }

  isRunning(): boolean {
    return this.server.isListening();
  }

  getConfig(): MultiplexerConfig | null {
    return this.config;
  }

  getMetricsView() {
    return this.metricsAggregator.getView();
  }

  private buildProxyServerConfig(config: MultiplexerConfig): ProxyServerConfig {
    return {
      port: config.router.port,
      storageDir: this.deps.storageDir,
      logDir: this.deps.logDir,
      maxLogSizeMb: 10,
      maxBodyLogBytes: 4 * 1024 * 1024,
      spillLargeBodies: true,
      developmentMode: false,
      trafficDiagnostics: false,
      diagnosticsIntervalMs: 30_000,
    };
  }
}
