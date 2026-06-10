/** Multiplexor routing strategy identifier. */
export type MultiplexerRoutingStrategy = 'sticky-session' | 'workspace-path';

/** Per-upstream metrics shown in the Accounts panel. */
export interface MultiplexerUpstreamMetrics {
  id: string;
  host: string;
  port: number;
  requests: number;
  activeConnections: number;
  healthy: boolean;
}

/** Multiplexor status pushed to the webview. */
export interface MultiplexerStatusView {
  running: boolean;
  port?: number;
  strategy?: MultiplexerRoutingStrategy;
  activeSessions: number;
  upstreams: MultiplexerUpstreamMetrics[];
}
