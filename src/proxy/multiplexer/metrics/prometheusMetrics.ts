import type { MultiplexerMetricsSnapshot } from '../../../domain/ports/IMultiplexerMetrics';

/** Formats multiplexor metrics as Prometheus text exposition. */
export function formatPrometheusMetrics(
  snapshot: MultiplexerMetricsSnapshot
): string {
  const lines: string[] = [
    '# HELP multiplexer_requests_total Total routed requests',
    '# TYPE multiplexer_requests_total counter',
    `multiplexer_requests_total ${snapshot.totalRequests}`,
    '# HELP multiplexer_active_sessions Active client sessions',
    '# TYPE multiplexer_active_sessions gauge',
    `multiplexer_active_sessions ${snapshot.activeSessions}`,
  ];

  for (const [upstreamId, metrics] of Object.entries(snapshot.upstreamMetrics)) {
    lines.push(
      `multiplexer_upstream_requests_total{upstream="${upstreamId}"} ${metrics.requests}`
    );
    lines.push(
      `multiplexer_upstream_connections{upstream="${upstreamId}"} ${metrics.activeConnections}`
    );
    lines.push(
      `multiplexer_upstream_health{upstream="${upstreamId}"} ${metrics.healthy ? 1 : 0}`
    );
  }

  for (const [reason, count] of Object.entries(snapshot.routingByReason)) {
    lines.push(
      `multiplexer_routing_decisions_total{reason="${reason}"} ${count ?? 0}`
    );
  }

  return `${lines.join('\n')}\n`;
}
