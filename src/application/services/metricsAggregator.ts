import type { IMultiplexerMetrics } from '../../domain/ports/IMultiplexerMetrics';
import type { IUpstreamPool } from '../../domain/ports/IUpstreamPool';
import type { MultiplexerMetricsView } from '../types/multiplexerMetrics';

/**
 * Application service: aggregates multiplexor and upstream metrics.
 */
export class MetricsAggregator {
  constructor(
    private readonly metrics: IMultiplexerMetrics,
    private readonly upstreamPool: IUpstreamPool,
    private readonly strategyName?: string,
    private readonly routerPort?: number
  ) {}

  getView(): MultiplexerMetricsView {
    const snapshot = this.metrics.getSnapshot();

    for (const upstream of this.upstreamPool.getAll()) {
      const existing = snapshot.upstreamMetrics[upstream.id];
      snapshot.upstreamMetrics[upstream.id] = {
        requests: existing?.requests ?? 0,
        activeConnections: upstream.connectionCount,
        healthy: upstream.healthy,
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
