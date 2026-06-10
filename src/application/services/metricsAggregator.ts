import type { IMultiplexerMetrics } from '../../domain/ports/IMultiplexerMetrics';
import type { IUpstreamWorkerRegistry } from '../../domain/ports/IUpstreamWorkerRegistry';
import type { MultiplexerMetricsView } from '../types/multiplexerMetrics';

/**
 * Application service: aggregates multiplexor and upstream worker metrics.
 */
export class MetricsAggregator {
  constructor(
    private readonly metrics: IMultiplexerMetrics,
    private readonly workerRegistry: IUpstreamWorkerRegistry,
    private readonly strategyName?: string,
    private readonly routerPort?: number
  ) {}

  getView(): MultiplexerMetricsView {
    const snapshot = this.metrics.getSnapshot();

    for (const worker of this.workerRegistry.getAll()) {
      const existing = snapshot.upstreamMetrics[worker.id];
      snapshot.upstreamMetrics[worker.id] = {
        requests: existing?.requests ?? worker.trafficReceived,
        activeConnections: existing?.activeConnections ?? 0,
        healthy: worker.healthy,
      };
    }

    return {
      snapshot,
      generatedAt: new Date().toISOString(),
      routerPort: this.routerPort,
      strategy: this.strategyName,
    };
  }
}
