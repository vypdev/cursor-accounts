import type { HttpProtocolVersion } from '../../domain/types/httpProtocol';

/** Single JSON Lines log record exchanged with the proxy traffic decoder. */
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
  /** Relative path under log dir when body was spilled to disk. */
  bodyFile?: string;
  isConnectRpc?: boolean;
  isCursorHost?: boolean;
  requestId?: string;
  errorKind?: string;
  errorMessage?: string;
  /** HTTP version on the client-to-proxy leg. */
  protocolVersion?: HttpProtocolVersion;
}
