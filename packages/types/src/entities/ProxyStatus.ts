/** Live proxy status exposed to the webview and commands. */
export interface ProxyStatus {
  running: boolean;
  port?: number;
  /** Localhost HTTP/WebSocket control-plane port. */
  apiPort?: number;
  pid?: number;
  startedAt?: number;
  caCertificatePath?: string;
  caCertificateInstalled?: boolean;
  logDirectory?: string;
  statistics?: ProxyStatistics;
}

/** Agent/chat RPC counters for bypass diagnosis (MITM-visible only). */
export interface ProxyAgentSignalCounts {
  bidiAppendRequests: number;
  bidiAppendResponses: number;
  runSseRequests: number;
  runSseResponses: number;
  streamBidiSseRequests: number;
  streamBidiSseResponses: number;
  runPollRequests: number;
  runPollResponses: number;
  liveTokenUpdates: number;
}

/** Periodic snapshot to detect likely proxy bypass. */
export interface ProxyTrafficDiagnostics {
  startedAt: string;
  windowSeconds: number;
  connectHosts: Record<string, number>;
  requestHosts: Record<string, number>;
  rpcPaths: Record<string, number>;
  protocolByHost: Record<string, Record<string, number>>;
  agentSignals: ProxyAgentSignalCounts;
  tlsErrors: number;
  bypassHints: string[];
  lastAgentSignalAt?: string;
}

/** Aggregated traffic counters from the proxy child process. */
export interface ProxyStatistics {
  totalRequests: number;
  cursorRequests: number;
  bytesTransferred: number;
  activeConnections: number;
  /** Present when traffic diagnostics are enabled in the proxy child. */
  diagnostics?: ProxyTrafficDiagnostics;
}

/** Persisted proxy state for a single profile (stored in userDataDir). */
export interface ProxyStateFile {
  version: number;
  profileId: string;
  running: boolean;
  port?: number;
  /** Localhost HTTP/WebSocket control-plane port (separate from MITM port). */
  apiPort?: number;
  /** Capability token for the localhost proxy control plane. */
  apiToken?: string;
  pid?: number;
  startedAt?: string;
  caCertificatePath?: string;
  lastUpdatedAt: string;
}
