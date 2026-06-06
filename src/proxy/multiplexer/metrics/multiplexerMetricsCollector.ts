import type {
  IMultiplexerMetrics,
  MultiplexerMetricsSnapshot,
} from '../../../domain/ports/IMultiplexerMetrics';
import type { RoutingReason } from '../../../domain/types/multiplexerTypes';

/** In-memory multiplexor metrics collector. */
export class MultiplexerMetricsCollector implements IMultiplexerMetrics {
  private totalRequests = 0;
  private activeSessions = 0;
  private readonly upstreamMetrics: MultiplexerMetricsSnapshot['upstreamMetrics'] =
    {};
  private readonly routingByReason: Partial<Record<RoutingReason, number>> = {};

  recordRouting(upstreamId: string, reason: RoutingReason): void {
    this.totalRequests++;
    const current = this.upstreamMetrics[upstreamId] ?? {
      requests: 0,
      activeConnections: 0,
      healthy: true,
    };
    current.requests++;
    this.upstreamMetrics[upstreamId] = current;
    this.routingByReason[reason] = (this.routingByReason[reason] ?? 0) + 1;
  }

  recordConnectionStart(upstreamId: string): void {
    const current = this.upstreamMetrics[upstreamId] ?? {
      requests: 0,
      activeConnections: 0,
      healthy: true,
    };
    current.activeConnections++;
    this.upstreamMetrics[upstreamId] = current;
  }

  recordConnectionEnd(upstreamId: string): void {
    const current = this.upstreamMetrics[upstreamId];
    if (!current) {
      return;
    }
    current.activeConnections = Math.max(0, current.activeConnections - 1);
  }

  setActiveSessions(count: number): void {
    this.activeSessions = count;
  }

  getSnapshot(): MultiplexerMetricsSnapshot {
    return {
      totalRequests: this.totalRequests,
      activeSessions: this.activeSessions,
      upstreamMetrics: { ...this.upstreamMetrics },
      routingByReason: { ...this.routingByReason },
    };
  }

  reset(): void {
    this.totalRequests = 0;
    this.activeSessions = 0;
    for (const key of Object.keys(this.upstreamMetrics)) {
      delete this.upstreamMetrics[key];
    }
    for (const key of Object.keys(this.routingByReason)) {
      delete this.routingByReason[key as RoutingReason];
    }
  }
}
