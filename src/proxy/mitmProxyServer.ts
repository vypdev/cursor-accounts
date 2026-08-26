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
import { getProtoRegistry } from './protoRegistry';
import { isCursorHost } from './utils/proxyRequestMetadata';
import type { ProxyTrafficLogger } from './nullLogger';
import {
  ProxyTrafficDiagnosticsCollector,
} from './proxyTrafficDiagnostics';
import { toTrafficSummary } from './proxyTrafficFormat';
import type { StreamingAgentDecoder } from './streamingAgentDecoder';
import { RunSseStreamHandler } from './capture/runSseStreamHandler';
import { CursorModelPricingProvider } from '../modelEfficiency/cursorModelPricingProvider';
import { ProxyLiveCostCalculator } from '../domain/services/ProxyLiveCostCalculator';
import { createMitmProxyRequestHandler } from './mitmProxyRequestHandler';
import { createMitmProxyResponseHandler } from './mitmProxyResponseHandler';
import {
  createProxyTrafficSummaryDispatcher,
  type ProxyTrafficSummaryDispatcher,
} from './proxyTrafficSummaryDispatcher';
import type {
  MitmProxyHandlers,
  ProxyLogEntry,
  ProxyServerConfig,
} from './types';
import { ProxyTrafficSessionCoordinator } from './proxyTrafficSessionCoordinator';

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
  /** Active incremental decoders for RunSSE response streams. */
  private readonly streamingDecoders = new Map<string, StreamingAgentDecoder>();
  private diagnostics: ProxyTrafficDiagnosticsCollector | null = null;
  private readonly runSseHandler: RunSseStreamHandler;
  private readonly liveCostCalculator = new ProxyLiveCostCalculator(
    new CursorModelPricingProvider()
  );
  private readonly sessionCoordinator: ProxyTrafficSessionCoordinator;
  private readonly trafficSummaryDispatcher: ProxyTrafficSummaryDispatcher;

  constructor(
    private readonly certificateManager: CertificateManager,
    private readonly requestLogger: ProxyTrafficLogger,
    private readonly handlers?: MitmProxyHandlers,
    userIdToProfileId?: Map<string, string>
  ) {
    super();
    this.sessionCoordinator = new ProxyTrafficSessionCoordinator(
      {
        onTraffic: (summary) => {
          this.handlers?.onTraffic?.(summary);
        },
      },
      userIdToProfileId
    );
    this.trafficSummaryDispatcher = createProxyTrafficSummaryDispatcher({
      enabled: Boolean(this.handlers?.onTraffic),
      onTraffic: (summary) => this.handlers?.onTraffic?.(summary),
      sessionCoordinator: this.sessionCoordinator,
    });
    this.runSseHandler = new RunSseStreamHandler(
      (summary) => {
        this.sessionCoordinator.dispatch(summary);
      },
      {
        costCalculator: this.liveCostCalculator,
        resolveModelId: (bidiRequestId) =>
          this.sessionCoordinator.resolveModelId(bidiRequestId),
        resolveConversationId: (bidiRequestId) =>
          this.sessionCoordinator.resolveConversationId(bidiRequestId),
      }
    );
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
    if (config.userIdToProfileId) {
      this.sessionCoordinator.setUserIdToProfileId(
        new Map(Object.entries(config.userIdToProfileId))
      );
    }
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

    proxy.onRequest(
      createMitmProxyRequestHandler({
        statistics: this.statistics,
        requestStartedAt: this.requestStartedAt,
        requestLogger: this.requestLogger,
        getDiagnostics: () => this.diagnostics,
        buildRequestUrl: (ctx) => this.buildRequestUrl(ctx),
        protocolVersionFor: (req) => this.protocolVersionFor(req),
        recordDiagnostics: (input) => this.recordDiagnostics(input),
        emitTrafficSummary: this.trafficSummaryDispatcher,
      })
    );

    proxy.onResponse(
      createMitmProxyResponseHandler({
        statistics: this.statistics,
        requestStartedAt: this.requestStartedAt,
        streamingDecoders: this.streamingDecoders,
        requestLogger: this.requestLogger,
        runSseHandler: this.runSseHandler,
        getDiagnostics: () => this.diagnostics,
        getProtoRegistry,
        buildRequestUrl: (ctx) => this.buildRequestUrl(ctx),
        protocolVersionFor: (req) => this.protocolVersionFor(req),
        recordDiagnostics: (input) => this.recordDiagnostics(input),
        emitTrafficSummary: this.trafficSummaryDispatcher,
      })
    );

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
    this.sessionCoordinator.clear();
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
