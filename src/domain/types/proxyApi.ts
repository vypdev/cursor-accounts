import type { ProxyStatistics } from '@cursor-accounts/types';
import type { ProxyTrafficSummary } from './proxyTraffic';

/** Canonical REST paths exposed by the proxy control-plane API. */
export const PROXY_API_PATHS = {
  health: '/api/health',
  status: '/api/status',
  stats: '/api/stats',
  shutdown: '/api/shutdown',
  ws: '/ws',
} as const;

export type ProxyApiEventType =
  | 'traffic'
  | 'stats'
  | 'diagnostics'
  | 'error';

/** WebSocket / broadcast envelope emitted by the proxy API server. */
export interface ProxyApiEvent {
  type: ProxyApiEventType;
  timestamp: string;
  profileId?: string;
  data:
    | ProxyTrafficSummary
    | ProxyStatistics
    | ProxyApiDiagnosticsPayload
    | ProxyApiErrorPayload;
}

export interface ProxyApiDiagnosticsPayload {
  lines: string[];
}

export interface ProxyApiErrorPayload {
  message: string;
  kind?: string;
}

/** GET /api/status response body. */
export interface ProxyApiStatusResponse {
  running: boolean;
  mitmPort: number;
  apiPort: number;
  profileId?: string;
  pid?: number;
  startedAt?: string;
  uptimeMs?: number;
}

/** GET /api/health response body. */
export interface ProxyApiHealthResponse {
  ok: boolean;
  version: number;
}

/** Options for starting the proxy API server inside the child process. */
export interface ProxyApiServerOptions {
  apiPort: number;
  mitmPort: number;
  /** Optional capability token. Legacy callers may omit it during migration. */
  apiToken?: string;
  profileId?: string;
  pid?: number;
  startedAt: string;
  getStatistics: () => ProxyStatistics;
  getDiagnosticsLines?: () => string[];
  onShutdownRequested?: () => void;
}

/** Default offset from MITM port to API port when not explicitly configured. */
export const DEFAULT_PROXY_API_PORT_OFFSET = 10_000;
