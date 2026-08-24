/** Configuration passed to the proxy child process. */
export interface ProxyServerConfig {
  port: number;
  /** Dedicated localhost API port (defaults to port + apiPortOffset). */
  apiPort: number;
  profileId: string;
  storageDir: string;
  logDir: string;
  maxLogSizeMb: number;
  /** Max body size stored inline in JSONL; larger bodies written to bodies/*.bin */
  maxBodyLogBytes: number;
  spillLargeBodies: boolean;
  /** When true, writes JSONL logs for debugging. When false, traffic flows via API only. */
  developmentMode: boolean;
  /** Aggregate hosts/RPCs/agent signals and bypass hints (stderr + API stats). */
  trafficDiagnostics: boolean;
  /** How often the child emits diagnostics on stats API/WS (ms). */
  diagnosticsIntervalMs: number;
  /** Mapping userId (JWT sub) → profileId for shared multi-profile proxy. */
  userIdToProfileId?: Record<string, string>;
  /** Mapping profileId → absolute SQLite DB path for agent tracking. */
  profileDbPaths?: Record<string, string>;
  /** Extension root path (migrations, bundled sqlite3 binary). */
  extensionPath?: string;
}
