import type { RoutingStrategyName } from '../../domain/types/multiplexerTypes';

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

/** Full multiplexor configuration DTO. */
export interface MultiplexerConfig {
  router: MultiplexerRouterConfig;
  routing: MultiplexerRoutingConfig;
  health: MultiplexerHealthConfig;
}

export const GLOBAL_MULTIPLEXER_PORT = 9000;
export const DEFAULT_MULTIPLEXER_HOST = '127.0.0.1';

export const DEFAULT_MULTIPLEXER_CONFIG: MultiplexerConfig = {
  router: {
    port: GLOBAL_MULTIPLEXER_PORT,
    host: DEFAULT_MULTIPLEXER_HOST,
  },
  routing: {
    strategy: 'workspace-path',
    fallbackStrategy: 'sticky-session',
    sessionTimeoutMs: 3_600_000,
  },
  health: {
    checkIntervalMs: 30_000,
    timeoutMs: 5_000,
    unhealthyThreshold: 3,
  },
};

/** Builds multiplexor config with optional overrides (deep-merges routing/health/router). */
export function buildMultiplexerConfig(
  partial?: Partial<MultiplexerConfig>
): MultiplexerConfig {
  return {
    router: { ...DEFAULT_MULTIPLEXER_CONFIG.router, ...partial?.router },
    routing: { ...DEFAULT_MULTIPLEXER_CONFIG.routing, ...partial?.routing },
    health: { ...DEFAULT_MULTIPLEXER_CONFIG.health, ...partial?.health },
  };
}
