import type { IncomingMessage } from 'http';
import type { Proxy } from 'http-mitm-proxy';
import type { ProxyStatistics } from '@cursor-accounts/types';
import type { HttpProtocolVersion } from '../domain/types/httpProtocol';
import type { ProxyTrafficLogger } from './nullLogger';
import type { ProxyLogEntry } from './types';
import {
  isConnectRpcContentType,
  isCursorHost,
  normalizeHeaders,
  redactHeadersForLog,
} from './utils/proxyRequestMetadata';
import { decompressBodyBuffer } from './bodyFormat';
import type { ProtoRegistry } from './protoRegistry';
import { isAgentIncrementalStreamUrl } from './agentStreamUrls';
import { bidiRequestIdFromRunSseHeaders } from './runSseCorrelation';
import { extractRequestId } from './proxyTrafficFormat';
import { StreamingAgentDecoder } from './streamingAgentDecoder';
import type { RunSseStreamHandler } from './capture/runSseStreamHandler';
import type {
  ProxyTrafficDiagnosticsCollector,
  RecordProxyRequestInput,
} from './proxyTrafficDiagnostics';

type OnResponseParams = Parameters<Proxy['onResponse']>[0];

export interface ResponseTrafficCorrelation {
  bidiRequestId?: string;
  httpRequestId?: string;
  incrementalTurnsAlreadyPersisted?: boolean;
}

export interface MitmProxyResponseHandlerDependencies {
  statistics: ProxyStatistics;
  requestStartedAt: Map<string, number>;
  streamingDecoders: Map<string, StreamingAgentDecoder>;
  requestLogger: ProxyTrafficLogger;
  runSseHandler: RunSseStreamHandler;
  getDiagnostics: () => ProxyTrafficDiagnosticsCollector | null;
  getProtoRegistry: () => Promise<ProtoRegistry>;
  buildRequestUrl: (ctx: Parameters<OnResponseParams>[0]) => string;
  protocolVersionFor: (req: IncomingMessage) => HttpProtocolVersion | undefined;
  recordDiagnostics: (input: RecordProxyRequestInput) => void;
  emitTrafficSummary: (
    entry: ProxyLogEntry,
    durationMs?: number,
    correlation?: ResponseTrafficCorrelation
  ) => void;
}

interface RunSseChunkContext {
  url: string;
  host: string;
  statusCode?: number;
  isCursorHost: boolean;
}

/**
 * Capture response bodies and process incremental agent streams without
 * coupling the transport callback to the concrete MITM server.
 */
export function createMitmProxyResponseHandler(
  dependencies: MitmProxyResponseHandlerDependencies
): OnResponseParams {
  return (ctx, callback) => {
    const { requestStartedAt, streamingDecoders } = dependencies;
    const host = ctx.clientToProxyRequest.headers.host ?? '';
    const headers = normalizeHeaders(ctx.serverToProxyResponse?.headers ?? {});
    const contentType = headers['content-type'];
    const url = dependencies.buildRequestUrl(ctx);
    const statusCode = ctx.serverToProxyResponse?.statusCode;
    const requestHeaders = normalizeHeaders(ctx.clientToProxyRequest.headers);
    const requestId = extractRequestId(requestHeaders);
    const bidiRequestId = bidiRequestIdFromRunSseHeaders(requestHeaders);
    const startedAt = requestId ? requestStartedAt.get(requestId) : undefined;
    const durationMs =
      startedAt != null ? Math.max(0, Date.now() - startedAt) : undefined;
    if (requestId) {
      requestStartedAt.delete(requestId);
    }

    const isRunSSE = isAgentIncrementalStreamUrl(url) && Boolean(requestId);
    let decoderReady: Promise<void> | undefined;
    if (isRunSSE && requestId) {
      decoderReady = dependencies.getProtoRegistry().then((registry) => {
        if (!streamingDecoders.has(requestId)) {
          streamingDecoders.set(requestId, new StreamingAgentDecoder(registry));
        }
      });
    }

    const streamContext: RunSseChunkContext = {
      url,
      host,
      statusCode,
      isCursorHost: isCursorHost(host),
    };
    const bodyChunks: Buffer[] = [];
    ctx.onResponseData((_ctx, chunk, cb) => {
      bodyChunks.push(chunk);
      if (isRunSSE && requestId) {
        void processRunSseChunk(
          dependencies,
          chunk,
          requestId,
          bidiRequestId,
          decoderReady,
          streamContext
        );
      }
      cb(null, chunk);
    });

    ctx.onResponseEnd((_ctx, endCallback) => {
      void finalizeResponse(
        dependencies,
        ctx,
        bodyChunks,
        headers,
        contentType,
        url,
        host,
        statusCode,
        requestId,
        bidiRequestId,
        durationMs,
        isRunSSE,
        decoderReady
      ).then(endCallback, endCallback);
    });

    callback();
  };
}

async function processRunSseChunk(
  dependencies: MitmProxyResponseHandlerDependencies,
  chunk: Buffer,
  requestId: string,
  bidiRequestId: string | undefined,
  decoderReady: Promise<void> | undefined,
  context: RunSseChunkContext
): Promise<void> {
  try {
    await decoderReady;
    const decoder = dependencies.streamingDecoders.get(requestId);
    if (!decoder) {
      return;
    }

    const result = decoder.feedChunk(chunk);
    const emitContext = {
      ...context,
      bidiRequestId,
      httpRequestId: requestId,
    };
    for (const liveUpdate of result.liveUpdates) {
      dependencies.getDiagnostics()?.recordLiveTokenUpdate();
      dependencies.runSseHandler.emitLiveTokenUpdate(liveUpdate, emitContext);
    }
    for (const turnEnded of result.turnEndedEvents) {
      dependencies.runSseHandler.emitTurnEnded(turnEnded, emitContext);
    }
  } catch {
    // Ignore incremental decode errors; batch decode at stream end still logs.
  }
}

async function finalizeResponse(
  dependencies: MitmProxyResponseHandlerDependencies,
  ctx: Parameters<OnResponseParams>[0],
  bodyChunks: Buffer[],
  headers: Record<string, string>,
  contentType: string | undefined,
  url: string,
  host: string,
  statusCode: number | undefined,
  requestId: string | undefined,
  bidiRequestId: string | undefined,
  durationMs: number | undefined,
  isRunSSE: boolean,
  decoderReady: Promise<void> | undefined
): Promise<void> {
  const { statistics, requestLogger, streamingDecoders } = dependencies;
  statistics.activeConnections = Math.max(0, statistics.activeConnections - 1);

  let incrementalTurnsAlreadyPersisted = false;
  if (isRunSSE && requestId) {
    try {
      await decoderReady;
      const decoder = streamingDecoders.get(requestId);
      if (decoder) {
        incrementalTurnsAlreadyPersisted = true;
        const finalLive = decoder.finalize();
        const streamContext = {
          url,
          host,
          statusCode,
          bidiRequestId,
          httpRequestId: requestId,
          isCursorHost: isCursorHost(host),
        };
        if (finalLive) {
          dependencies.runSseHandler.emitLiveTokenUpdate(finalLive, streamContext);
        }
        streamingDecoders.delete(requestId);
      }
    } catch {
      streamingDecoders.delete(requestId);
    }
  }

  const rawBody = Buffer.concat(bodyChunks);
  statistics.bytesTransferred += rawBody.length;
  const contentEncoding = headers['content-encoding'];
  const { body, decompressed } = decompressBodyBuffer(rawBody, contentEncoding);
  const spillKey = requestId ? `${requestId}-response` : undefined;
  const formatted = requestLogger.formatBody(body, contentType, spillKey);
  const entry: ProxyLogEntry = {
    timestamp: new Date().toISOString(),
    direction: 'response',
    url,
    host,
    statusCode,
    headers: redactHeadersForLog(headers),
    ...formatted,
    bodyDecompressed: decompressed || undefined,
    isConnectRpc: isConnectRpcContentType(contentType),
    isCursorHost: isCursorHost(host),
    requestId,
    protocolVersion: dependencies.protocolVersionFor(ctx.clientToProxyRequest),
  };
  requestLogger.log(entry);
  dependencies.recordDiagnostics({
    method: ctx.clientToProxyRequest.method,
    url,
    host,
    direction: 'response',
    protocolVersion: entry.protocolVersion,
  });
  dependencies.emitTrafficSummary(entry, durationMs, {
    bidiRequestId,
    httpRequestId: requestId,
    incrementalTurnsAlreadyPersisted,
  });
}
