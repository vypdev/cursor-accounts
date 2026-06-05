import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';
import { Proxy } from 'http-mitm-proxy';
import type { ProxyStatistics } from '@cursor-accounts/types';
import type { IProxyServer } from '../domain/ports/IProxyServer';
import type { HttpProtocolVersion } from '../domain/types/httpProtocol';
import type { CertificateManager } from './certificateManager';
import { detectHttpProtocolVersion } from './protocolDetection';
import { shouldLogMitmClientError } from './mitmClientErrorFilter';
import type { MitmListenOptions } from './types';
import { decompressBodyBuffer } from './bodyFormat';
import { getProtoRegistry } from './protoRegistry';
import {
  isConnectRpcContentType,
  isCursorHost,
  normalizeHeaders,
} from './utils/proxyRequestMetadata';
import type { ProxyTrafficLogger } from './nullLogger';
import { isAgentIncrementalStreamUrl } from './agentStreamUrls';
import {
  parseConnectTunnelHost,
  ProxyTrafficDiagnosticsCollector,
} from './proxyTrafficDiagnostics';
import { extractRequestId, toTrafficSummary } from './proxyTrafficFormat';
import { extractBidiRequestIdFromBody } from './runSseCorrelation';
import { StreamingAgentDecoder } from './streamingAgentDecoder';
import { buildTrafficSummary } from './trafficSummaryBuilder';
import { RunSseStreamHandler } from './capture/runSseStreamHandler';
import type {
  MitmProxyHandlers,
  ProxyLogEntry,
  ProxyServerConfig,
} from './types';

export interface MitmProxyServerEvents {
  error: (error: Error) => void;
}

/**
 * HTTP/HTTPS MITM proxy using http-mitm-proxy.
 * Emits traffic through RequestLogger and optional handlers.
 */
export class MitmProxyServer extends EventEmitter implements IProxyServer {
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
  private diagnostics: ProxyTrafficDiagnosticsCollector | null = null;
  private readonly runSseHandler: RunSseStreamHandler;

  constructor(
    private readonly certificateManager: CertificateManager,
    private readonly requestLogger: ProxyTrafficLogger,
    private readonly handlers?: MitmProxyHandlers
  ) {
    super();
    this.runSseHandler = new RunSseStreamHandler((summary) => {
      this.handlers?.onTraffic?.(summary);
    });
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

    const proxy = this.createMitmProxy();
    this.proxy = proxy;
    this.diagnostics = config.trafficDiagnostics
      ? new ProxyTrafficDiagnosticsCollector()
      : null;

    proxy.onError((ctx, err, errorKind) => {
      const host = ctx?.clientToProxyRequest?.headers?.host ?? '';
      const url = ctx ? this.buildRequestUrl(ctx) : '';
      const message = err instanceof Error ? err.message : String(err);
      if (!shouldLogMitmClientError(errorKind, message)) {
        return;
      }
      this.diagnostics?.recordTlsError();
      const errorEntry: ProxyLogEntry = {
        timestamp: new Date().toISOString(),
        direction: 'error',
        url: url || host || 'unknown',
        host: host || 'unknown',
        headers: {},
        errorKind: errorKind ?? 'PROXY_ERROR',
        errorMessage: message,
        isCursorHost: host ? isCursorHost(host) : undefined,
      };
      this.requestLogger.log(errorEntry);
      this.handlers?.onProxyError?.(toTrafficSummary(errorEntry));
      this.emit('error', err instanceof Error ? err : new Error(message));
    });

    proxy.onRequest((ctx, callback) => {
      this.statistics.totalRequests += 1;
      this.statistics.activeConnections += 1;

      const host = ctx.clientToProxyRequest.headers.host ?? '';
      const url = this.buildRequestUrl(ctx);
      const method = ctx.clientToProxyRequest.method;

      if (this.diagnostics) {
        const connectTarget = parseConnectTunnelHost(method, url, host);
        if (connectTarget) {
          this.diagnostics.recordConnect(connectTarget);
        }
      }

      if (isCursorHost(host)) {
        this.statistics.cursorRequests += 1;
      }

      const headers = normalizeHeaders(
        ctx.clientToProxyRequest.headers as Record<string, string | string[] | undefined>
      );
      const contentType = headers['content-type'];
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
          isConnectRpc: isConnectRpcContentType(contentType),
          isCursorHost: isCursorHost(host),
          requestId,
          protocolVersion: this.protocolVersionFor(ctx.clientToProxyRequest),
        };
        this.requestLogger.log(entry);
        this.recordDiagnostics({
          method,
          url,
          host,
          direction: 'request',
          protocolVersion: entry.protocolVersion,
        });
        if (isAgentIncrementalStreamUrl(url) && requestId) {
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
      const headers = normalizeHeaders(
        ctx.serverToProxyResponse?.headers as
          | Record<string, string | string[] | undefined>
          | undefined ?? {}
      );
      const contentType = headers['content-type'];
      const url = this.buildRequestUrl(ctx);
      const statusCode = ctx.serverToProxyResponse?.statusCode;
      const requestHeaders = normalizeHeaders(
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

      const isRunSSE = isAgentIncrementalStreamUrl(url) && Boolean(requestId);
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
              isCursorHost: isCursorHost(host),
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
              const finalLive = decoder.finalize();
              const bidiRequestId = this.runSSEBidiIds.get(requestId);
              const streamContext = {
                url,
                host,
                statusCode,
                bidiRequestId,
                httpRequestId: requestId,
                isCursorHost: isCursorHost(host),
              };
              if (finalLive) {
                this.runSseHandler.emitLiveTokenUpdate(finalLive, streamContext);
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
          isConnectRpc: isConnectRpcContentType(contentType),
          isCursorHost: isCursorHost(host),
          requestId,
          protocolVersion: this.protocolVersionFor(ctx.clientToProxyRequest),
        };
        this.requestLogger.log(entry);
        this.recordDiagnostics({
          method: ctx.clientToProxyRequest.method,
          url,
          host,
          direction: 'response',
          protocolVersion: entry.protocolVersion,
        });
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

    const listenOptions = this.getMitmListenOptions(sslCaDir, config.port);

    await new Promise<void>((resolve, reject) => {
      proxy.listen(listenOptions, (err?: Error) => {
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
    this.diagnostics = null;
    await this.requestLogger.close();
  }

  getStatistics(): ProxyStatistics {
    const stats: ProxyStatistics = { ...this.statistics };
    if (this.diagnostics) {
      stats.diagnostics = this.diagnostics.getSnapshot();
    }
    return stats;
  }

  formatDiagnosticsLines(): string[] {
    return this.diagnostics?.formatSummaryLines() ?? [];
  }

  private recordDiagnostics(input: {
    method?: string;
    url: string;
    host: string;
    direction: 'request' | 'response';
    protocolVersion?: HttpProtocolVersion;
  }): void {
    this.diagnostics?.recordRequest(input);
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

      const result = decoder.feedChunk(chunk);
      const bidiRequestId = this.runSSEBidiIds.get(requestId);
      const emitContext = {
        ...context,
        bidiRequestId,
        httpRequestId: requestId,
      };
      for (const liveUpdate of result.liveUpdates) {
        this.diagnostics?.recordLiveTokenUpdate();
        this.runSseHandler.emitLiveTokenUpdate(liveUpdate, emitContext);
      }
      for (const turnEnded of result.turnEndedEvents) {
        this.runSseHandler.emitTurnEnded(turnEnded, emitContext);
      }
    } catch {
      // Ignore incremental decode errors; batch decode at stream end still logs.
    }
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

  /**
   * Factory for the underlying http-mitm-proxy instance (override in {@link PolyglotMitmProxyServer}).
   */
  protected createMitmProxy(): Proxy {
    return new Proxy();
  }

  /** Listen options passed to http-mitm-proxy (override for HTTP/2 / forceSNI). */
  protected getMitmListenOptions(sslCaDir: string, port: number): MitmListenOptions {
    return { port, host: '127.0.0.1', sslCaDir };
  }

  private protocolVersionFor(req: IncomingMessage) {
    try {
      return detectHttpProtocolVersion(req);
    } catch {
      return undefined;
    }
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
