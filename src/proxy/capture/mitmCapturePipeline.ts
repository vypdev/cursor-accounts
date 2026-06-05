import { decompressBodyBuffer } from '../bodyFormat';
import type { ProxyTrafficLogger } from '../nullLogger';
import type { ProxyLogEntry } from '../types';
import {
  isConnectRpcContentType,
  isCursorHost,
  normalizeHeaders,
} from '../utils/proxyRequestMetadata';

export interface CaptureRequestInput {
  timestamp: string;
  method: string;
  url: string;
  host: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  contentType?: string;
  requestId?: string;
  protocolVersion?: ProxyLogEntry['protocolVersion'];
  spillKey?: string;
}

export interface CaptureResponseInput extends CaptureRequestInput {
  statusCode: number;
  contentEncoding?: string;
  requestHeaders?: Record<string, string | string[] | undefined>;
}

/**
 * Normalizes MITM request/response capture into ProxyLogEntry records.
 */
export class MitmCapturePipeline {
  constructor(private readonly requestLogger: ProxyTrafficLogger) {}

  captureRequest(input: CaptureRequestInput): ProxyLogEntry {
    const headers = normalizeHeaders(input.headers);
    const formatted = this.requestLogger.formatBody(
      input.body,
      input.contentType,
      input.spillKey
    );

    return {
      timestamp: input.timestamp,
      direction: 'request',
      method: input.method,
      url: input.url,
      host: input.host,
      headers,
      ...formatted,
      isConnectRpc: isConnectRpcContentType(input.contentType),
      isCursorHost: isCursorHost(input.host),
      requestId: input.requestId,
      protocolVersion: input.protocolVersion,
    };
  }

  captureResponse(input: CaptureResponseInput): ProxyLogEntry {
    const headers = normalizeHeaders(input.headers);
    const { body, decompressed } = decompressBodyBuffer(
      input.body,
      input.contentEncoding
    );
    const formatted = this.requestLogger.formatBody(
      body,
      input.contentType,
      input.spillKey
    );

    return {
      timestamp: input.timestamp,
      direction: 'response',
      method: input.method,
      url: input.url,
      host: input.host,
      statusCode: input.statusCode,
      headers,
      ...formatted,
      bodyDecompressed: decompressed || undefined,
      isConnectRpc: isConnectRpcContentType(input.contentType),
      isCursorHost: isCursorHost(input.host),
      requestId: input.requestId,
      protocolVersion: input.protocolVersion,
    };
  }
}
