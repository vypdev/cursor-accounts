import type { RoutingReason } from '../types/multiplexerTypes';

/** Snapshot of multiplexor metrics. */
export interface MultiplexerMetricsSnapshot {
  totalRequests: number;
  activeSessions: number;
  upstreamMetrics: Record<
    string,
    {
      requests: number;
      activeConnections: number;
      healthy: boolean;
    }
  >;
  routingByReason: Partial<Record<RoutingReason, number>>;
}

/**
 * Port: collects and exposes multiplexor metrics.
 */
export interface IMultiplexerMetrics {
  recordRouting(upstreamId: string, reason: RoutingReason): void;
  recordConnectionStart(upstreamId: string): void;
  recordConnectionEnd(upstreamId: string): void;
  setActiveSessions(count: number): void;
  getSnapshot(): MultiplexerMetricsSnapshot;
  reset(): void;
}
