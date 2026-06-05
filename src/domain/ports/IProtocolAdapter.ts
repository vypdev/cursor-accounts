import type { HttpProtocolVersion } from '../types/httpProtocol';

export interface RequestInfo {
  method: string;
  url: string;
  host: string;
  headers: Record<string, string>;
  protocol: HttpProtocolVersion;
}

/**
 * Normalizes HTTP/1.x or HTTP/2 request metadata for logging and insights.
 */
export interface IProtocolAdapter {
  extractHeaders(raw: Record<string, string | string[] | undefined>): Record<string, string>;
  buildRequestInfo(raw: unknown): RequestInfo;
  getProtocolVersion(): HttpProtocolVersion;
}
