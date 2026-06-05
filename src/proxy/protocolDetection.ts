import type { IncomingMessage } from 'http';
import type { IProtocolAdapter } from '../domain/ports/IProtocolAdapter';
import type { HttpProtocolVersion } from '../domain/types/httpProtocol';
import { Http2ProtocolAdapter } from './adapters/http2ProtocolAdapter';
import { createHttp1xProtocolAdapter } from './adapters/http1xProtocolAdapter';

export function isHttp2Request(req: IncomingMessage): boolean {
  return req.httpVersion === '2.0';
}

export function resolveProtocolAdapter(req: IncomingMessage): IProtocolAdapter {
  if (isHttp2Request(req)) {
    return new Http2ProtocolAdapter();
  }
  return createHttp1xProtocolAdapter(req);
}

export function detectHttpProtocolVersion(req: IncomingMessage): HttpProtocolVersion {
  return resolveProtocolAdapter(req).getProtocolVersion();
}
