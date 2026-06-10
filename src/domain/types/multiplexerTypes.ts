/** Supported routing strategy identifiers. */
export type RoutingStrategyName = 'sticky-session' | 'workspace-path';

/** Reason codes attached to routing decisions for observability. */
export type RoutingReason =
  | 'sticky-session-hit'
  | 'sticky-session-new'
  | 'sticky-session-fallback'
  | 'workspace-path-hit'
  | 'workspace-path-new'
  | 'workspace-path-fallback'
  | 'failover';

/** Health state of an upstream proxy. */
export type UpstreamHealthState = 'healthy' | 'unhealthy' | 'unknown';
