import type { ProxyApiEvent } from './types/proxyApi';
import type { ProxyServerConfig } from './types/proxyConfig';
import type { ProxyServerRuntimeDependencies } from './types/proxyServerRuntime';
import type { ProxyTrafficSummary } from '../domain/types/proxyTraffic';

const STATS_INTERVAL_MS = 5_000;

/**
 * Coordinates the standalone proxy child process without owning process
 * termination. The executable composition root decides the exit code.
 */
export class ProxyServerRuntime {
  private statsInterval: ReturnType<typeof setInterval> | undefined;
  private diagnosticsInterval: ReturnType<typeof setInterval> | undefined;
  private config: ProxyServerConfig | undefined;
  private shutdownPromise: Promise<void> | undefined;

  constructor(private readonly dependencies: ProxyServerRuntimeDependencies) {
    this.dependencies.proxyServer.on('error', (error) => {
      this.handleProxyError(error);
    });
  }

  async start(config: ProxyServerConfig, pid: number): Promise<void> {
    this.config = config;
    await this.dependencies.apiServer.start({
      apiPort: config.apiPort,
      apiToken: config.apiToken,
      mitmPort: config.port,
      profileId: config.profileId,
      pid,
      startedAt: this.dependencies.now(),
      getStatistics: () => this.dependencies.proxyServer.getStatistics(),
      getDiagnosticsLines: () =>
        this.dependencies.proxyServer.formatDiagnosticsLines(),
      onShutdownRequested: () => {
        const shutdown = this.shutdown();
        this.dependencies.onShutdownRequested?.(shutdown);
      },
    });

    await this.dependencies.proxyServer.start(config);
    this.dependencies.writeStderr(
      `[proxy] MITM listening on 127.0.0.1:${config.port}, API on 127.0.0.1:${config.apiPort}\n`
    );

    this.statsInterval = setInterval(() => {
      this.emitStats(config);
    }, STATS_INTERVAL_MS);

    if (config.trafficDiagnostics) {
      this.emitDiagnostics(config);
      this.diagnosticsInterval = setInterval(() => {
        this.emitDiagnostics(config);
      }, config.diagnosticsIntervalMs);
    }
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = (async () => {
      if (this.statsInterval) {
        clearInterval(this.statsInterval);
        this.statsInterval = undefined;
      }
      if (this.diagnosticsInterval) {
        clearInterval(this.diagnosticsInterval);
        this.diagnosticsInterval = undefined;
      }

      // Stop producing traffic before closing the ingress. The ingress then
      // drains all per-profile queues before SQLite connections are closed.
      await this.dependencies.proxyServer.stop().catch(() => undefined);
      await this.dependencies.trackingIngress?.close().catch(() => undefined);
      await this.dependencies.apiServer.stop().catch(() => undefined);
    })();

    return this.shutdownPromise;
  }

  emitTraffic(config: ProxyServerConfig, summary: ProxyTrafficSummary): void {
    const pendingPersistence = this.dependencies.trackingIngress?.enqueue(summary);
    pendingPersistence?.catch(() => undefined);

    const sanitized = {
      ...summary,
      bodyDecoded: undefined,
    };
    const event: ProxyApiEvent = {
      type: 'traffic',
      timestamp: this.dependencies.now(),
      profileId: summary.profileId ?? config.profileId,
      data: sanitized,
    };
    this.dependencies.apiServer.broadcast(event);
  }

  private emitStats(config: ProxyServerConfig): void {
    const event: ProxyApiEvent = {
      type: 'stats',
      timestamp: this.dependencies.now(),
      profileId: config.profileId,
      data: this.dependencies.proxyServer.getStatistics(),
    };
    this.dependencies.apiServer.broadcast(event);
  }

  private emitDiagnostics(config: ProxyServerConfig): void {
    if (!config.trafficDiagnostics) {
      return;
    }
    const lines = this.dependencies.proxyServer.formatDiagnosticsLines();
    for (const line of lines) {
      this.dependencies.writeStderr(`${line}\n`);
    }
    if (lines.length > 0) {
      this.dependencies.apiServer.broadcast({
        type: 'diagnostics',
        timestamp: this.dependencies.now(),
        profileId: config.profileId,
        data: { lines },
      });
    }
  }

  private handleProxyError(error: unknown): void {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error) ?? 'Unknown proxy error';
    this.dependencies.writeStderr(`[proxy] ${message}\n`);
    this.dependencies.apiServer.broadcast({
      type: 'error',
      timestamp: this.dependencies.now(),
      profileId: this.config?.profileId,
      data: {
        message,
        kind: 'PROXY_ERROR',
      },
    });
  }
}
