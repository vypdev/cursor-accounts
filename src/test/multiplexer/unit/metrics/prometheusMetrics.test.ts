import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatPrometheusMetrics } from '../../../../proxy/multiplexer/metrics/prometheusMetrics';

describe('formatPrometheusMetrics', () => {
  it('renders counters and gauges', () => {
    const output = formatPrometheusMetrics({
      totalRequests: 12,
      activeSessions: 3,
      upstreamMetrics: {
        u1: { requests: 7, activeConnections: 2, healthy: true },
      },
      routingByReason: {
        'sticky-session-hit': 5,
      },
    });

    assert.match(output, /multiplexer_requests_total 12/);
    assert.match(output, /multiplexer_active_sessions 3/);
    assert.match(output, /multiplexer_upstream_requests_total\{upstream="u1"\} 7/);
    assert.match(output, /multiplexer_routing_decisions_total\{reason="sticky-session-hit"\} 5/);
  });
});
