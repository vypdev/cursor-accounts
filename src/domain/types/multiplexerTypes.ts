/** Supported routing strategy identifiers. */
export type RoutingStrategyName =
  | 'sticky-session'
  | 'token-hash'
  | 'round-robin'
  | 'least-connections'
  | 'hybrid'
  | 'workspace-path';

/** Reason codes attached to routing decisions for observability. */
export type RoutingReason =
  | 'sticky-session-hit'
  | 'sticky-session-new'
  | 'sticky-session-fallback'
  | 'token-hash'
  | 'round-robin'
  | 'least-connections'
  | 'workspace-path-hit'
  | 'workspace-path-new'
  | 'workspace-path-fallback'
  | 'hybrid-primary'
  | 'hybrid-fallback'
  | 'failover';

/** Health state of an upstream proxy. */
export type UpstreamHealthState = 'healthy' | 'unhealthy' | 'unknown';
