import { EventEmitter } from 'events';
import { Proxy } from 'http-mitm-proxy';
import type { ProxyStatistics } from '@cursor-accounts/types';
import type { CertificateManager } from './certificateManager';
import { decompressBodyBuffer } from './bodyFormat';
import { getProtoRegistry } from './protoRegistry';
import { RequestLogger } from './requestLogger';
import type { ProxyTrafficLogger } from './nullLogger';
import { extractRequestId, formatEndpoint, toTrafficSummary } from './proxyTrafficFormat';
import { extractBidiRequestIdFromBody } from './runSseCorrelation';
import {
  StreamingAgentDecoder,
  type CompletedTurn,
} from './streamingAgentDecoder';
import { buildTrafficSummary } from './trafficSummaryBuilder';
import type {
  MitmProxyHandlers,
  ProxyLogEntry,
  ProxyServerConfig,
  ProxyTrafficSummary,
} from './types';

export interface MitmProxyServerEvents {
  error: (error: Error) => void;
}

/**
 * HTTP/HTTPS MITM proxy using http-mitm-proxy.
 * Emits traffic through RequestLogger and optional handlers.
 */
export class MitmProxyServer extends EventEmitter {
  private proxy: Proxy | null = null;
  private statistics: ProxyStatistics = {
    totalRequests: 0,
    cursorRequests: 0,
    bytesTransferred: 0,
    activeConnections: 0,
  };
  private readonly requestStartedAt = new Map<string, number>();
  /** HTTP requestId → bidi request_id for RunSSE correlation. */
  private readonly runSSEBidiIds = new Map<string, string>();
  /** Active incremental decoders for RunSSE response streams. */
  private readonly streamingDecoders = new Map<string, StreamingAgentDecoder>();

  constructor(
    private readonly certificateManager: CertificateManager,
    private readonly requestLogger: ProxyTrafficLogger,
    private readonly handlers?: MitmProxyHandlers
  ) {
    super();
  }

  /**
   * Start listening on the configured port (localhost only).
   */
  async start(config: ProxyServerConfig): Promise<void> {
    if (this.proxy) {
      return;
    }

    const sslCaDir = await this.certificateManager.ensureCaDirectoryForMitm();
    await this.requestLogger.initialize();

    try {
      await getProtoRegistry();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[proxy] proto registry init failed: ${message}\n`);
    }

    const proxy = new Proxy();
    this.proxy = proxy;

    proxy.onError((ctx, err, errorKind) => {
      const host = ctx?.clientToProxyRequest?.headers?.host ?? '';
      const url = ctx ? this.buildRequestUrl(ctx) : '';
      const message = err instanceof Error ? err.message : String(err);
      const errorEntry: ProxyLogEntry = {
        timestamp: new Date().toISOString(),
        direction: 'error',
        url: url || host || 'unknown',
        host: host || 'unknown',
        headers: {},
        errorKind: errorKind ?? 'PROXY_ERROR',
        errorMessage: message,
        isCursorHost: host ? RequestLogger.isCursorHost(host) : undefined,
      };
      this.requestLogger.log(errorEntry);
      this.handlers?.onProxyError?.(toTrafficSummary(errorEntry));
      this.emit('error', err instanceof Error ? err : new Error(message));
    });

    proxy.onRequest((ctx, callback) => {
      this.statistics.totalRequests += 1;
      this.statistics.activeConnections += 1;

      const host = ctx.clientToProxyRequest.headers.host ?? '';
      if (RequestLogger.isCursorHost(host)) {
        this.statistics.cursorRequests += 1;
      }

      const headers = RequestLogger.normalizeHeaders(
        ctx.clientToProxyRequest.headers as Record<string, string | string[] | undefined>
      );
      const contentType = headers['content-type'];
      const url = this.buildRequestUrl(ctx);
      const requestId = extractRequestId(headers);
      if (requestId) {
        this.requestStartedAt.set(requestId, Date.now());
      }

      const bodyChunks: Buffer[] = [];
      ctx.onRequestData((_ctx, chunk, cb) => {
        bodyChunks.push(chunk);
        cb(null, chunk);
      });

      ctx.onRequestEnd(async (_ctx, endCallback) => {
        const rawBody = Buffer.concat(bodyChunks);
        this.statistics.bytesTransferred += rawBody.length;
        const contentEncoding = headers['content-encoding'];
        const { body, decompressed } = decompressBodyBuffer(
          rawBody,
          contentEncoding
        );
        const spillKey = requestId
          ? `${requestId}-request`
          : undefined;
        const formatted = this.requestLogger.formatBody(
          body,
          contentType,
          spillKey
        );
        const entry: ProxyLogEntry = {
          timestamp: new Date().toISOString(),
          direction: 'request',
          method: ctx.clientToProxyRequest.method,
          url,
          host,
          headers,
          ...formatted,
          bodyDecompressed: decompressed || undefined,
          isConnectRpc: RequestLogger.isConnectRpcContentType(contentType),
          isCursorHost: RequestLogger.isCursorHost(host),
          requestId,
        };
        this.requestLogger.log(entry);
        if (url.includes('RunSSE') && requestId) {
          const bidiId = await extractBidiRequestIdFromBody(rawBody, contentType);
          if (bidiId) {
            this.runSSEBidiIds.set(requestId, bidiId);
          }
        }
        this.emitTrafficSummary(entry);
        endCallback();
      });

      callback();
    });

    proxy.onResponse((ctx, callback) => {
      const host = ctx.clientToProxyRequest.headers.host ?? '';
      const headers = RequestLogger.normalizeHeaders(
        ctx.serverToProxyResponse?.headers as
          | Record<string, string | string[] | undefined>
          | undefined ?? {}
      );
      const contentType = headers['content-type'];
      const url = this.buildRequestUrl(ctx);
      const statusCode = ctx.serverToProxyResponse?.statusCode;
      const requestHeaders = RequestLogger.normalizeHeaders(
        ctx.clientToProxyRequest.headers as Record<string, string | string[] | undefined>
      );
      const requestId = extractRequestId(requestHeaders);
      const startedAt = requestId
        ? this.requestStartedAt.get(requestId)
        : undefined;
      const durationMs =
        startedAt != null ? Math.max(0, Date.now() - startedAt) : undefined;
      if (requestId) {
        this.requestStartedAt.delete(requestId);
      }

      const isRunSSE = url.includes('RunSSE') && Boolean(requestId);
      let decoderReady: Promise<void> | undefined;

      if (isRunSSE && requestId) {
        decoderReady = getProtoRegistry().then((registry) => {
          if (!this.streamingDecoders.has(requestId)) {
            this.streamingDecoders.set(
              requestId,
              new StreamingAgentDecoder(registry)
            );
          }
        });
      }

      const bodyChunks: Buffer[] = [];
      ctx.onResponseData((_ctx, chunk, cb) => {
        bodyChunks.push(chunk);
        if (isRunSSE && requestId) {
          void this.processRunSSEChunk(
            chunk,
            requestId,
            decoderReady,
            {
              url,
              host,
              statusCode,
              isCursorHost: RequestLogger.isCursorHost(host),
            }
          );
        }
        cb(null, chunk);
      });

      ctx.onResponseEnd(async (_ctx, endCallback) => {
        this.statistics.activeConnections = Math.max(
          0,
          this.statistics.activeConnections - 1
        );

        let incrementalTurnsAlreadyPersisted = false;
        if (isRunSSE && requestId) {
          try {
            await decoderReady;
            const decoder = this.streamingDecoders.get(requestId);
            if (decoder) {
              incrementalTurnsAlreadyPersisted = true;
              const finalTurn = decoder.finalize();
              const bidiRequestId = this.runSSEBidiIds.get(requestId);
              if (finalTurn) {
                this.emitPartialTurn(finalTurn, {
                  url,
                  host,
                  statusCode,
                  bidiRequestId,
                  httpRequestId: requestId,
                  isCursorHost: RequestLogger.isCursorHost(host),
                });
              }
              this.streamingDecoders.delete(requestId);
            }
          } catch {
            this.streamingDecoders.delete(requestId);
          }
        }

        const rawBody = Buffer.concat(bodyChunks);
        this.statistics.bytesTransferred += rawBody.length;
        const contentEncoding = headers['content-encoding'];
        const { body, decompressed } = decompressBodyBuffer(
          rawBody,
          contentEncoding
        );
        const spillKey = requestId
          ? `${requestId}-response`
          : undefined;
        const formatted = this.requestLogger.formatBody(
          body,
          contentType,
          spillKey
        );
        const entry: ProxyLogEntry = {
          timestamp: new Date().toISOString(),
          direction: 'response',
          url,
          host,
          statusCode,
          headers,
          ...formatted,
          bodyDecompressed: decompressed || undefined,
          isConnectRpc: RequestLogger.isConnectRpcContentType(contentType),
          isCursorHost: RequestLogger.isCursorHost(host),
          requestId,
        };
        this.requestLogger.log(entry);
        const bidiRequestId = requestId
          ? this.runSSEBidiIds.get(requestId)
          : undefined;
        if (requestId && bidiRequestId) {
          this.runSSEBidiIds.delete(requestId);
        }
        this.emitTrafficSummary(entry, durationMs, {
          bidiRequestId,
          httpRequestId: requestId,
          incrementalTurnsAlreadyPersisted,
        });
        endCallback();
      });

      callback();
    });

    await new Promise<void>((resolve, reject) => {
      proxy.listen(
        { port: config.port, host: '127.0.0.1', sslCaDir },
        (err?: Error) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  async stop(): Promise<void> {
    if (!this.proxy) {
      return;
    }

    const closing = this.proxy;
    this.proxy = null;

    await Promise.race([
      new Promise<void>((resolve) => {
        closing.close(() => {
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 2_000);
      }),
    ]);

    this.requestStartedAt.clear();
    this.runSSEBidiIds.clear();
    this.streamingDecoders.clear();
    await this.requestLogger.close();
  }

  getStatistics(): ProxyStatistics {
    return { ...this.statistics };
  }

  private async processRunSSEChunk(
    chunk: Buffer,
    requestId: string,
    decoderReady: Promise<void> | undefined,
    context: {
      url: string;
      host: string;
      statusCode?: number;
      isCursorHost: boolean;
    }
  ): Promise<void> {
    try {
      await decoderReady;
      const decoder = this.streamingDecoders.get(requestId);
      if (!decoder) {
        return;
      }

      const turns = decoder.feedChunk(chunk);
      const bidiRequestId = this.runSSEBidiIds.get(requestId);
      for (const turn of turns) {
        this.emitPartialTurn(turn, {
          ...context,
          bidiRequestId,
          httpRequestId: requestId,
        });
      }
    } catch {
      // Ignore incremental decode errors; batch decode at stream end still logs.
    }
  }

  private emitPartialTurn(
    completed: CompletedTurn,
    context: {
      url: string;
      host: string;
      statusCode?: number;
      bidiRequestId?: string;
      httpRequestId?: string;
      isCursorHost: boolean;
    }
  ): void {
    if (!this.handlers?.onTraffic) {
      return;
    }

    const summary: ProxyTrafficSummary = {
      timestamp: new Date().toISOString(),
      kind: 'response',
      url: context.url,
      host: context.host,
      endpoint: formatEndpoint(context.url, context.host),
      statusCode: context.statusCode,
      rpcPath: context.url.includes('/')
        ? context.url.replace(/^https?:\/\/[^/]+/, '')
        : undefined,
      insights: {
        agent: {
          ...completed.agent,
          requestId: context.bidiRequestId,
        },
        allTokenFrames: completed.allFrames,
        completedTurn: completed.turn,
      },
      httpRequestId: context.httpRequestId,
      isCursorHost: context.isCursorHost,
    };

    this.handlers.onTraffic(summary);
  }

  private emitTrafficSummary(
    entry: ProxyLogEntry,
    durationMs?: number,
    correlation?: {
      bidiRequestId?: string;
      httpRequestId?: string;
      incrementalTurnsAlreadyPersisted?: boolean;
    }
  ): void {
    if (!this.handlers?.onTraffic) {
      return;
    }

    void buildTrafficSummary(entry, durationMs, correlation)
      .then((summary) => {
        if (correlation?.incrementalTurnsAlreadyPersisted) {
          summary.insights = {
            ...summary.insights,
            streamingTurnsAlreadyPersisted: true,
          };
          if (summary.insights?.allTokenFrames) {
            delete summary.insights.allTokenFrames;
          }
        }
        this.handlers?.onTraffic?.(summary);
      })
      .catch(() => {
        this.handlers?.onTraffic?.(toTrafficSummary(entry, durationMs));
      });
  }

  private buildRequestUrl(ctx: {
    clientToProxyRequest: { method?: string; url?: string; headers: { host?: string } };
    isSSL?: boolean;
  }): string {
    const host = ctx.clientToProxyRequest.headers.host ?? 'unknown';
    const pathPart = ctx.clientToProxyRequest.url ?? '/';
    const scheme = ctx.isSSL ? 'https' : 'http';
    if (pathPart.startsWith('http://') || pathPart.startsWith('https://')) {
      return pathPart;
    }
    return `${scheme}://${host}${pathPart}`;
  }
}
