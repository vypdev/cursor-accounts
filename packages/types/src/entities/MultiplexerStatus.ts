/** Multiplexor routing strategy identifier. */
export type MultiplexerRoutingStrategy =
  | 'sticky-session'
  | 'token-hash'
  | 'round-robin'
  | 'least-connections'
  | 'hybrid'
  | 'workspace-path';

/** Per-upstream metrics shown in the Accounts panel. */
export interface MultiplexerUpstreamMetrics {
  id: string;
  host: string;
  port: number;
  requests: number;
  activeConnections: number;
  healthy: boolean;
}

/** Active session binding for multiplexor observability. */
export interface MultiplexerSessionView {
  sessionKey: string;
  upstreamId: string;
  workspacePath?: string;
  assignedAt: string;
}

/** Multiplexor status pushed to the webview. */
export interface MultiplexerStatusView {
  running: boolean;
  port?: number;
  strategy?: MultiplexerRoutingStrategy;
  upstreamCount: number;
  activeSessions: number;
  upstreams: MultiplexerUpstreamMetrics[];
  sessions: MultiplexerSessionView[];
}
