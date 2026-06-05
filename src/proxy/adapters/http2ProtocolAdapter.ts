import type { IncomingHttpHeaders } from 'http';
import type { Http2ServerRequest } from 'http2';
import type { IProtocolAdapter, RequestInfo } from '../../domain/ports/IProtocolAdapter';
import { normalizeHeaders } from '../utils/proxyRequestMetadata';

function headerValue(
  headers: IncomingHttpHeaders,
  name: string
): string | undefined {
  const value = headers[name];
  if (value == null) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : String(value);
}

/**
 * Maps HTTP/2 pseudo-headers to the same shape used for HTTP/1 JSONL logs.
 */
export class Http2ProtocolAdapter implements IProtocolAdapter {
  getProtocolVersion(): 'HTTP/2' {
    return 'HTTP/2';
  }

  extractHeaders(raw: Record<string, string | string[] | undefined>): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value == null) {
        continue;
      }
      const lower = key.startsWith(':') ? key : key.toLowerCase();
      normalized[lower] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    if (normalized[':method'] && !normalized.method) {
      normalized.method = normalized[':method'];
    }
    if (normalized[':authority'] && !normalized.host) {
      normalized.host = normalized[':authority'];
    }
    return normalizeHeaders(
      normalized as Record<string, string | string[] | undefined>
    );
  }

  buildRequestInfo(raw: unknown): RequestInfo {
    const req = raw as Http2ServerRequest;
    const rawHeaders = req.headers as Record<string, string | string[] | undefined>;
    const headers = this.extractHeaders(rawHeaders);
    const method = headerValue(req.headers, ':method') ?? req.method ?? 'GET';
    const pathPart = headerValue(req.headers, ':path') ?? req.url ?? '/';
    const authority =
      headerValue(req.headers, ':authority') ??
      headerValue(req.headers, 'host') ??
      'unknown';
    const scheme = headerValue(req.headers, ':scheme') ?? 'https';
    const url =
      pathPart.startsWith('http://') || pathPart.startsWith('https://')
        ? pathPart
        : `${scheme}://${authority}${pathPart}`;

    return {
      method,
      url,
      host: authority,
      headers: {
        ...headers,
        method,
        host: authority,
      },
      protocol: 'HTTP/2',
    };
  }
}
