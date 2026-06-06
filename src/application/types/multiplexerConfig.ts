import type { RoutingStrategyName } from '../../domain/types/multiplexerTypes';
import type { UpstreamConfig } from '../../domain/ports/IUpstreamPool';

/** Router listener configuration. */
export interface MultiplexerRouterConfig {
  port: number;
  host: string;
}

/** Routing policy configuration. */
export interface MultiplexerRoutingConfig {
  strategy: RoutingStrategyName;
  fallbackStrategy?: RoutingStrategyName;
  sessionTimeoutMs?: number;
}

/** Health check configuration. */
export interface MultiplexerHealthConfig {
  checkIntervalMs: number;
  timeoutMs: number;
  unhealthyThreshold: number;
}

/** Metrics collection configuration. */
export interface MultiplexerMetricsConfig {
  enabled: boolean;
  aggregationIntervalMs?: number;
}

/** Full multiplexor configuration DTO. */
export interface MultiplexerConfig {
  router: MultiplexerRouterConfig;
  upstreams: UpstreamConfig[];
  routing: MultiplexerRoutingConfig;
  health: MultiplexerHealthConfig;
  metrics?: MultiplexerMetricsConfig;
}

export const DEFAULT_MULTIPLEXER_PORT = 9999;
export const DEFAULT_MULTIPLEXER_HOST = '127.0.0.1';

export const DEFAULT_MULTIPLEXER_CONFIG: MultiplexerConfig = {
  router: {
    port: DEFAULT_MULTIPLEXER_PORT,
    host: DEFAULT_MULTIPLEXER_HOST,
  },
  upstreams: [],
  routing: {
    strategy: 'sticky-session',
    fallbackStrategy: 'least-connections',
    sessionTimeoutMs: 3_600_000,
  },
  health: {
    checkIntervalMs: 30_000,
    timeoutMs: 5_000,
    unhealthyThreshold: 3,
  },
  metrics: {
    enabled: true,
    aggregationIntervalMs: 60_000,
  },
};
