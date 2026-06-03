import type { ProxyStatistics } from '@cursor-accounts/types';

export const PROXY_STATE_FILE_NAME = 'proxy-state.json';
export const PROXY_STATE_SCHEMA_VERSION = 1;
export const PROXY_STATE_STALE_MS = 5 * 60 * 1000;
export const DEFAULT_PROXY_PORT = 8080;
export const PROXY_PORT_FALLBACKS = [8080, 8081, 8082, 8888] as const;
export const MAX_BODY_LOG_BYTES = 10 * 1024;
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
}

/** Single JSON Lines log record for a request or response. */
export interface ProxyLogEntry {
  timestamp: string;
  direction: 'request' | 'response';
  method?: string;
  url: string;
  host: string;
  statusCode?: number;
  headers: Record<string, string>;
  body?: string;
  bodyTruncated?: boolean;
  isConnectRpc?: boolean;
  isCursorHost?: boolean;
}

/** IPC messages from parent to child. */
export type ProxyParentMessage =
  | { type: 'shutdown' }
  | { type: 'getStats' };

/** IPC messages from child to parent. */
export type ProxyChildMessage =
  | { type: 'ready'; port: number }
  | { type: 'error'; message: string }
  | { type: 'stats'; data: ProxyStatistics };
