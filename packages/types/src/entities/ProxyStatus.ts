/** Live proxy status exposed to the webview and commands. */
export interface ProxyStatus {
  running: boolean;
  port?: number;
  pid?: number;
  startedAt?: number;
  caCertificatePath?: string;
  caCertificateInstalled?: boolean;
  logDirectory?: string;
  statistics?: ProxyStatistics;
}

/** Aggregated traffic counters from the proxy child process. */
export interface ProxyStatistics {
  totalRequests: number;
  cursorRequests: number;
  bytesTransferred: number;
  activeConnections: number;
}

/** Persisted proxy state for a single profile (stored in userDataDir). */
export interface ProxyStateFile {
  version: number;
  profileId: string;
  running: boolean;
  port?: number;
  pid?: number;
  startedAt?: string;
  caCertificatePath?: string;
  lastUpdatedAt: string;
}
