import type { MultiplexerMetricsSnapshot } from '../../../domain/ports/IMultiplexerMetrics';
import type { SessionBinding } from '../../../domain/ports/ISessionStore';
import type { RoutingStrategyName } from '../../../domain/types/multiplexerTypes';

/** Serializable upstream worker view exposed by the management API. */
export interface UpstreamDto {
  id: string;
  healthy: boolean;
  trafficReceived: number;
  metadata?: {
    profileId?: string;
    workspacePath?: string;
  };
}

/** GET /_api/health */
export interface HealthResponse {
  status: 'ok';
}

/** GET /_api/status */
export interface StatusResponse {
  running: boolean;
  port: number;
  strategy: string;
  activeSessions: number;
  upstreamCount: number;
}

/** GET /_api/metrics */
export interface MetricsResponse {
  snapshot: MultiplexerMetricsSnapshot;
  generatedAt: string;
  routerPort: number;
  strategy: string;
}

/** GET /_api/sessions */
export type SessionsResponse = readonly SessionBinding[];

/** GET /_api/config */
export interface ConfigResponse {
  router: {
    host: string;
    port: number;
  };
  routing: {
    strategy: RoutingStrategyName;
    fallbackStrategy?: RoutingStrategyName;
    sessionTimeoutMs?: number;
  };
}

/** POST /_api/upstreams */
export interface CreateUpstreamRequest {
  profileId: string;
  workspacePath: string;
  userDataDir?: string;
}

/** POST /_api/upstreams response */
export interface CreateUpstreamResponse {
  upstreamId: string;
}

/** Standard API error payload. */
export interface ErrorResponse {
  error: string;
  code?: string;
}
