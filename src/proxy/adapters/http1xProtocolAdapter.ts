import type { IncomingMessage } from 'http';
import type { IProtocolAdapter, RequestInfo } from '../../domain/ports/IProtocolAdapter';
import type { HttpProtocolVersion } from '../../domain/types/httpProtocol';
import { normalizeHeaders } from '../utils/proxyRequestMetadata';

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const value = headers[name];
  if (value == null) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
}

abstract class Http1xProtocolAdapterBase implements IProtocolAdapter {
  abstract getProtocolVersion(): HttpProtocolVersion;

  extractHeaders(
    raw: Record<string, string | string[] | undefined>
  ): Record<string, string> {
    return normalizeHeaders(raw);
  }

  buildRequestInfo(raw: unknown): RequestInfo {
    const req = raw as IncomingMessage;
    const headers = this.extractHeaders(
      req.headers
    );
    const host = firstHeader(req.headers, 'host') ?? 'unknown';
    const pathPart = req.url ?? '/';
    const encrypted = Boolean((req.socket as { encrypted?: boolean }).encrypted);
    const scheme = encrypted ? 'https' : 'http';
    const url =
      pathPart.startsWith('http://') || pathPart.startsWith('https://')
        ? pathPart
        : `${scheme}://${host}${pathPart}`;

    return {
      method: req.method ?? 'GET',
      url,
      host,
      headers,
      protocol: this.getProtocolVersion(),
    };
  }
}

export class Http10ProtocolAdapter extends Http1xProtocolAdapterBase {
  getProtocolVersion(): 'HTTP/1.0' {
    return 'HTTP/1.0';
  }
}

export class Http11ProtocolAdapter extends Http1xProtocolAdapterBase {
  getProtocolVersion(): 'HTTP/1.1' {
    return 'HTTP/1.1';
  }
}

/** Picks HTTP/1.0 vs HTTP/1.1 from an IncomingMessage. */
export function createHttp1xProtocolAdapter(req: IncomingMessage): IProtocolAdapter {
  const version = req.httpVersion;
  if (version === '1.0') {
    return new Http10ProtocolAdapter();
  }
  return new Http11ProtocolAdapter();
}
