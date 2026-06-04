import { EventEmitter } from 'events';
import { Proxy } from 'http-mitm-proxy';
import type { ProxyStatistics } from '@cursor-accounts/types';
import type { CertificateManager } from './certificateManager';
import { decompressBodyBuffer } from './bodyFormat';
import { getProtoRegistry } from './protoRegistry';
import { RequestLogger } from './requestLogger';
import type { ProxyTrafficLogger } from './nullLogger';
import { extractRequestId, toTrafficSummary } from './proxyTrafficFormat';
import { buildTrafficSummary } from './trafficSummaryBuilder';
import type { MitmProxyHandlers, ProxyLogEntry, ProxyServerConfig } from './types';

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

      ctx.onRequestEnd((_ctx, endCallback) => {
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

      const bodyChunks: Buffer[] = [];
      ctx.onResponseData((_ctx, chunk, cb) => {
        bodyChunks.push(chunk);
        cb(null, chunk);
      });

      ctx.onResponseEnd((_ctx, endCallback) => {
        this.statistics.activeConnections = Math.max(
          0,
          this.statistics.activeConnections - 1
        );
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
        this.emitTrafficSummary(entry, durationMs);
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
    await this.requestLogger.close();
  }

  getStatistics(): ProxyStatistics {
    return { ...this.statistics };
  }

  private emitTrafficSummary(entry: ProxyLogEntry, durationMs?: number): void {
    if (!this.handlers?.onTraffic) {
      return;
    }

    void buildTrafficSummary(entry, durationMs)
      .then((summary) => {
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
