/** Configuration passed to the proxy child process. */
export interface ProxyServerConfig {
  port: number;
  storageDir: string;
  logDir: string;
  maxLogSizeMb: number;
  /** Max body size stored inline in JSONL; larger bodies written to bodies/*.bin */
  maxBodyLogBytes: number;
  spillLargeBodies: boolean;
  /** When true, writes JSONL logs for debugging. When false, traffic flows via IPC only. */
  developmentMode: boolean;
  /** Aggregate hosts/RPCs/agent signals and bypass hints (stderr + IPC stats). */
  trafficDiagnostics: boolean;
  /** How often the child emits diagnostics on stats IPC (ms). */
  diagnosticsIntervalMs: number;
}
