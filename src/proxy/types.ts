import type { HttpProtocolVersion } from '../domain/types/httpProtocol';

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
  /** HTTP version on the client↔proxy leg (HTTP/1.0, HTTP/1.1, HTTP/2). */
  protocolVersion?: HttpProtocolVersion;
}
