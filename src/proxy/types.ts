import type { ProxyStatistics } from '@cursor-accounts/types';
import type { ProxyInsights } from './proxyInsightExtractor';

export const PROXY_STATE_FILE_NAME = 'proxy-state.json';
export const PROXY_STATE_SCHEMA_VERSION = 1;
export const DEFAULT_PROXY_PORT = 8080;
export const PROXY_PORT_FALLBACKS = [8080, 8081, 8082, 8888] as const;
/** Default inline body limit in JSONL (4 MiB raw); larger bodies spill to logDir/bodies/. */
export const DEFAULT_MAX_BODY_LOG_BYTES = 4 * 1024 * 1024;

/** @deprecated Use DEFAULT_MAX_BODY_LOG_BYTES */
export const MAX_BODY_LOG_BYTES = DEFAULT_MAX_BODY_LOG_BYTES;
export const CONNECT_RPC_CONTENT_TYPE = 'application/connect+proto';

export const CURSOR_HOST_SUFFIXES = [
  'cursor.sh',
  'cursor.com',
  'cursorapi.com',
] as const;

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
}

/** Single JSON Lines log record for a request, response, or proxy error. */
export interface ProxyLogEntry {
  timestamp: string;
  direction: 'request' | 'response' | 'error';
  method?: string;
  url: string;
  host: string;
  statusCode?: number;
  headers: Record<string, string>;
  body?: string;
  bodyBase64?: string;
  bodyEncoding?: 'utf8' | 'base64';
  bodyRawBytes?: number;
  bodyDecompressed?: boolean;
  bodyTruncated?: boolean;
  /** Relative path under log dir when body was spilled to disk */
  bodyFile?: string;
  isConnectRpc?: boolean;
  isCursorHost?: boolean;
  requestId?: string;
  errorKind?: string;
  errorMessage?: string;
}

/** Redacted traffic event for IPC and Output channel. */
export interface ProxyTrafficSummary {
  timestamp: string;
  kind: 'request' | 'response' | 'error';
  method?: string;
  url: string;
  host: string;
  endpoint: string;
  statusCode?: number;
  bodyBytes?: number;
  bodyKind?: 'json' | 'proto' | 'text' | 'empty';
  rpcPath?: string;
  bodyDecoded?: Record<string, unknown>;
  decodeError?: string;
  insights?: ProxyInsights;
  userAgent?: string;
  requestId?: string;
  isCursorHost?: boolean;
  durationMs?: number;
  errorKind?: string;
  errorMessage?: string;
}

export interface MitmProxyHandlers {
  onTraffic?: (summary: ProxyTrafficSummary) => void;
  onProxyError?: (summary: ProxyTrafficSummary) => void;
}

/** IPC messages from parent to child. */
export type ProxyParentMessage =
  | { type: 'shutdown' }
  | { type: 'getStats' };

/** IPC messages from child to parent. */
export type ProxyChildMessage =
  | { type: 'ready'; port: number }
  | { type: 'error'; message: string }
  | { type: 'stats'; data: ProxyStatistics }
  | { type: 'traffic'; summary: ProxyTrafficSummary };
