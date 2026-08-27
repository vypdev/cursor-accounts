import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';
import { Proxy } from 'http-mitm-proxy';
import type { ProxyStatistics } from '@cursor-accounts/types';
import type { IProxyServer } from '../domain/ports/IProxyServer';
import type { IMitmCertificateDirectory } from '../domain/ports/IMitmCertificateDirectory';
import type { HttpProtocolVersion } from '../domain/types/httpProtocol';
import { detectHttpProtocolVersion } from './protocolDetection';
import type { MitmListenOptions } from './types';
import { getProtoRegistry } from './protoRegistry';
import type { ProxyTrafficLogger } from './nullLogger';
import {
  ProxyTrafficDiagnosticsCollector,
} from './proxyTrafficDiagnostics';
import type { StreamingAgentDecoder } from './streamingAgentDecoder';
import { RunSseStreamHandler } from './capture/runSseStreamHandler';
import { CursorModelPricingProvider } from '../modelEfficiency/cursorModelPricingProvider';
import { ProxyLiveCostCalculator } from '../domain/services/ProxyLiveCostCalculator';
import {
  createProxyTrafficSummaryDispatcher,
  type ProxyTrafficSummaryDispatcher,
} from './proxyTrafficSummaryDispatcher';
import type { MitmProxyHandlers, ProxyServerConfig } from './types';
import { ProxyTrafficSessionCoordinator } from './proxyTrafficSessionCoordinator';
import { closeMitmProxy, listenToMitmProxy } from './mitmProxyLifecycle';
import { registerMitmProxyHandlers } from './mitmProxyHandlerRegistration';

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
  private startPromise: Promise<void> | undefined;

  constructor(
    private readonly certificateDirectory: IMitmCertificateDirectory,
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
    if (this.startPromise) {
      return this.startPromise;
    }

    const startPromise = this.startInternal(config);
    this.startPromise = startPromise;
    try {
      await startPromise;
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = undefined;
      }
    }
  }

  private async startInternal(config: ProxyServerConfig): Promise<void> {
    let proxy: Proxy | undefined;
    let loggerInitializationAttempted = false;

    try {
      const sslCaDir =
        await this.certificateDirectory.ensureCaDirectoryForMitm();
      loggerInitializationAttempted = true;
      await this.requestLogger.initialize();
      await this.initializeProtoRegistry();

      proxy = this.createMitmProxy();
      this.configureProxy(proxy, config);

      const listenOptions = this.getMitmListenOptions(sslCaDir, config.port);
      await listenToMitmProxy(proxy, listenOptions);
      this.proxy = proxy;
    } catch (error) {
      await this.cleanupFailedStart(proxy, loggerInitializationAttempted);
      throw error;
    }
  }

  private async initializeProtoRegistry(): Promise<void> {
    try {
      await getProtoRegistry();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[proxy] proto registry init failed: ${message}\n`);
    }
  }

  private configureProxy(proxy: Proxy, config: ProxyServerConfig): void {
    if (config.userIdToProfileId) {
      this.sessionCoordinator.setUserIdToProfileId(
        new Map(Object.entries(config.userIdToProfileId))
      );
    }
    this.diagnostics = config.trafficDiagnostics
      ? new ProxyTrafficDiagnosticsCollector()
      : null;

    registerMitmProxyHandlers(proxy, {
      error: {
        requestLogger: this.requestLogger,
        getDiagnostics: () => this.diagnostics,
        buildRequestUrl: (ctx) => this.buildRequestUrl(ctx),
        onProxyError: (summary) => this.handlers?.onProxyError?.(summary),
        emitError: (error) => this.emit('error', error),
      },
      request: {
        statistics: this.statistics,
        requestStartedAt: this.requestStartedAt,
        requestLogger: this.requestLogger,
        getDiagnostics: () => this.diagnostics,
        buildRequestUrl: (ctx) => this.buildRequestUrl(ctx),
        protocolVersionFor: (req) => this.protocolVersionFor(req),
        recordDiagnostics: (input) => this.recordDiagnostics(input),
        emitTrafficSummary: this.trafficSummaryDispatcher,
      },
      response: {
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
      },
    });
  }

  async stop(): Promise<void> {
    await this.startPromise?.catch(() => undefined);
    if (!this.proxy) {
      return;
    }

    const closing = this.proxy;
    this.proxy = null;

    await closeMitmProxy(closing);

    this.requestStartedAt.clear();
    this.sessionCoordinator.clear();
    this.streamingDecoders.clear();
    this.diagnostics = null;
    await this.requestLogger.close();
  }

  private async cleanupFailedStart(
    proxy: Proxy | undefined,
    loggerInitialized: boolean
  ): Promise<void> {
    if (proxy) {
      await closeMitmProxy(proxy).catch(() => undefined);
    }
    this.proxy = null;
    this.requestStartedAt.clear();
    this.sessionCoordinator.clear();
    this.streamingDecoders.clear();
    this.diagnostics = null;
    if (loggerInitialized) {
      await this.requestLogger.close().catch(() => undefined);
    }
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
