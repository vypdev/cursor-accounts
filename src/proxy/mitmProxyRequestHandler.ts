import type { IncomingMessage } from 'http';
import type { Proxy } from 'http-mitm-proxy';
import type { ProxyStatistics } from '@cursor-accounts/types';
import type { HttpProtocolVersion } from '../domain/types/httpProtocol';
import {
  isConnectRpcContentType,
  isCursorHost,
  normalizeHeaders,
  redactHeadersForLog,
} from './utils/proxyRequestMetadata';
import type { ProxyTrafficLogger } from './nullLogger';
import type { ProxyLogEntry } from './types';
import type {
  ProxyTrafficDiagnosticsCollector,
  RecordProxyRequestInput,
} from './proxyTrafficDiagnostics';
import { parseConnectTunnelHost } from './proxyTrafficDiagnostics';
import { decompressBodyBuffer } from './bodyFormat';
import { extractRequestId } from './proxyTrafficSummary';

type OnRequestParams = Parameters<Proxy['onRequest']>[0];

export interface MitmProxyRequestHandlerDependencies {
  statistics: ProxyStatistics;
  requestStartedAt: Map<string, number>;
  requestLogger: ProxyTrafficLogger;
  getDiagnostics: () => ProxyTrafficDiagnosticsCollector | null;
  buildRequestUrl: (ctx: Parameters<OnRequestParams>[0]) => string;
  protocolVersionFor: (req: IncomingMessage) => HttpProtocolVersion | undefined;
  recordDiagnostics: (input: RecordProxyRequestInput) => void;
  emitTrafficSummary: (entry: ProxyLogEntry) => void;
}

/**
 * Capture and forward request bodies while preserving the proxy stream.
 *
 * This adapter owns only request-side transport concerns. It does not decide
 * how traffic summaries are consumed; that remains an injected application
 * callback at the composition boundary.
 */
export function createMitmProxyRequestHandler(
  dependencies: MitmProxyRequestHandlerDependencies
): OnRequestParams {
  return (ctx, callback) => {
    const { statistics, requestStartedAt, requestLogger } = dependencies;
    statistics.totalRequests += 1;
    statistics.activeConnections += 1;

    const host = ctx.clientToProxyRequest.headers.host ?? '';
    const url = dependencies.buildRequestUrl(ctx);
    const method = ctx.clientToProxyRequest.method;
    const diagnostics = dependencies.getDiagnostics();

    if (diagnostics) {
      const connectTarget = parseConnectTunnelHost(method, url, host);
      if (connectTarget) {
        diagnostics.recordConnect(connectTarget);
      }
    }

    if (isCursorHost(host)) {
      statistics.cursorRequests += 1;
    }

    const headers = normalizeHeaders(ctx.clientToProxyRequest.headers);
    const contentType = headers['content-type'];
    const requestId = extractRequestId(headers);
    if (requestId) {
      requestStartedAt.set(requestId, Date.now());
    }

    const bodyChunks: Buffer[] = [];
    ctx.onRequestData((_ctx, chunk, cb) => {
      bodyChunks.push(chunk);
      cb(null, chunk);
    });

    ctx.onRequestEnd((_ctx, endCallback) => {
      const rawBody = Buffer.concat(bodyChunks);
      statistics.bytesTransferred += rawBody.length;
      const contentEncoding = headers['content-encoding'];
      const { body, decompressed } = decompressBodyBuffer(
        rawBody,
        contentEncoding
      );
      const spillKey = requestId ? `${requestId}-request` : undefined;
      const formatted = requestLogger.formatBody(body, contentType, spillKey);
      const entry: ProxyLogEntry = {
        timestamp: new Date().toISOString(),
        direction: 'request',
        method,
        url,
        host,
        headers: redactHeadersForLog(headers),
        ...formatted,
        bodyDecompressed: decompressed || undefined,
        isConnectRpc: isConnectRpcContentType(contentType),
        isCursorHost: isCursorHost(host),
        requestId,
        protocolVersion: dependencies.protocolVersionFor(
          ctx.clientToProxyRequest
        ),
      };
      requestLogger.log(entry);
      dependencies.recordDiagnostics({
        method,
        url,
        host,
        direction: 'request',
        protocolVersion: entry.protocolVersion,
      });
      dependencies.emitTrafficSummary(entry);
      endCallback();
    });

    callback();
  };
}
