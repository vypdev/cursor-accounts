export const PROXY_STATE_FILE_NAME = 'proxy-state.json';
export const PROXY_STATE_SCHEMA_VERSION = 1;
export const DEFAULT_PROXY_PORT = 8080;
export const SHARED_PROXY_RUNTIME_KEY = 'shared';
export const SHARED_PROXY_STATE_FILE_NAME = 'shared-proxy-state.json';
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

export type { ProxyServerConfig } from '../application/types/proxyConfig';
export type {
  MitmProxyHandlers,
  ProxyTrafficSummary,
} from '../application/types/proxyTraffic';
export type { ProxyInsights } from '../application/types/proxyInsights';

/** Options passed to http-mitm-proxy listen(). */
export interface MitmListenOptions {
  port: number;
  host: string;
  sslCaDir: string;
  forceSNI?: boolean;
}

/** Single JSON Lines log record for a request, response, or proxy error. */
export type { ProxyLogEntry } from '../application/types/proxyLog';
