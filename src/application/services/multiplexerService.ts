import type { IMultiplexerServer } from '../../domain/ports/IMultiplexerServer';
import type { IUpstreamPool } from '../../domain/ports/IUpstreamPool';
import type { ISessionStore } from '../../domain/ports/ISessionStore';
import type { MultiplexerConfig } from '../types/multiplexerConfig';
import { MetricsAggregator } from './metricsAggregator';
import { RoutingOrchestrator } from './routingOrchestrator';
import { UpstreamHealthMonitor } from './upstreamHealthMonitor';

/**
 * Application service: multiplexor lifecycle and request routing.
 */
export class MultiplexerService {
  private config: MultiplexerConfig | null = null;
  private sessionCleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly server: IMultiplexerServer,
    private readonly upstreamPool: IUpstreamPool,
    private readonly sessionStore: ISessionStore,
    private readonly healthMonitor: UpstreamHealthMonitor,
    private readonly routingOrchestrator: RoutingOrchestrator,
    private readonly metricsAggregator?: MetricsAggregator
  ) {}

  async start(config: MultiplexerConfig): Promise<void> {
    this.config = config;
    await this.upstreamPool.initialize(config.upstreams);
    await this.healthMonitor.start(
      this.upstreamPool,
      config.health.checkIntervalMs
    );

    await this.server.listen(
      config.router.port,
      config.router.host,
      async (session, context) => {
        const decision = await this.routingOrchestrator.route(session, context);
        return {
          host: decision.upstream.host,
          port: decision.upstream.port,
          upstreamId: decision.upstream.id,
        };
      }
    );

    const timeoutMs = config.routing.sessionTimeoutMs ?? 3_600_000;
    this.sessionCleanupTimer = setInterval(() => {
      const before = new Date(Date.now() - timeoutMs);
      this.sessionStore.clearExpired(before);
    }, Math.min(timeoutMs, 60_000));
  }

  async stop(): Promise<void> {
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer);
      this.sessionCleanupTimer = undefined;
    }
    await this.healthMonitor.stop();
    await this.server.close();
    this.config = null;
  }

  isRunning(): boolean {
    return this.server.isListening();
  }

  getConfig(): MultiplexerConfig | null {
    return this.config;
  }

  getMetricsView() {
    return this.metricsAggregator?.getView();
  }
}
