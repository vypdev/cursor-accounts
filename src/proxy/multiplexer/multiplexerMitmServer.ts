import type { IncomingMessage } from 'node:http';
import type { Proxy } from 'http-mitm-proxy';
import { decodeJwtPayload } from '../../auth/tokenReader';
import type { IProfileManager } from '../../domain/ports/IProfileManager';
import type { ProxyTrafficSummary } from '../../application/types/proxyTraffic';
import type { CertificateManager } from '../certificateManager';
import { NullLogger } from '../nullLogger';
import type { ProxyTrafficLogger } from '../nullLogger';
import { PolyglotMitmProxyServer } from '../polyglotMitmProxyServer';
import { normalizeHeaders } from '../utils/proxyRequestMetadata';
import type { ProxyServerConfig } from '../types';
import type { ManagementApiServer } from './api/managementApiServer';
import { ProtoPayloadExtractor } from './protoPayloadExtractor';
import {
  UpstreamWorkerManager,
  type UpstreamNotifier,
} from './upstreamWorkerManager';
import * as extensionLog from '../../logging/extensionLog';

const BIDI_APPEND_PATH = '/aiserver.v1.BidiService/BidiAppend';

interface RequestContext {
  profileId: string | null;
  workspacePath: string | null;
  authorization?: string;
}

/**
 * Global multiplexer MITM server on port 9000.
 * Proxies all IDE traffic and forwards agent traffic to upstream analysis workers.
 */
export class MultiplexerMitmServer extends PolyglotMitmProxyServer {
  private managementApi: ManagementApiServer | null = null;
  private upstreamNotifier: UpstreamNotifier | null = null;
  private profileManager: IProfileManager | undefined;
  private readonly payloadExtractor = new ProtoPayloadExtractor();
  private readonly requestContext = new Map<string, RequestContext>();
  private listeningPort: number | undefined;
  private isStarted = false;

  constructor(
    certificateManager: CertificateManager,
    requestLogger: ProxyTrafficLogger = new NullLogger()
  ) {
    super(certificateManager, requestLogger, {
      onTraffic: (summary) => {
        void this.routeAgentTraffic(summary);
      },
    });
  }

  setManagementApi(api: ManagementApiServer): void {
    this.managementApi = api;
  }

  setUpstreamNotifier(notifier: UpstreamWorkerManager): void {
    this.upstreamNotifier = notifier;
  }

  setProfileManager(profileManager: IProfileManager | undefined): void {
    this.profileManager = profileManager;
  }

  async start(config: ProxyServerConfig): Promise<void> {
    await super.start(config);
    this.listeningPort = config.port;
    this.isStarted = true;

    const httpServer = this.getHttpServer();
    if (httpServer && this.managementApi) {
      this.managementApi.attachToHttpServer(httpServer);
    }
  }

  async stop(): Promise<void> {
    const httpServer = this.getHttpServer();
    httpServer?.closeAllConnections?.();
    this.managementApi?.dispose();
    await super.stop();
    this.requestContext.clear();
    this.listeningPort = undefined;
    this.isStarted = false;
  }

  isListening(): boolean {
    return this.isStarted;
  }

  getPort(): number | undefined {
    return this.listeningPort;
  }

  /** @deprecated Use start() — kept for IMultiplexerServer compatibility during migration. */
  async listen(
    _port: number,
    _host: string,
    _handler?: unknown
  ): Promise<void> {
    throw new Error(
      'MultiplexerMitmServer.listen() is deprecated; use start(ProxyServerConfig) via MultiplexerService'
    );
  }

  /** @deprecated Use stop() */
  async close(): Promise<void> {
    await this.stop();
  }

  protected beforeListen(proxy: Proxy, _config: ProxyServerConfig): void {
    proxy.onRequest((ctx, callback) => {
      void this.captureRequestContext(ctx).finally(() => callback());
    });
  }

  private async captureRequestContext(ctx: {
    clientToProxyRequest: IncomingMessage;
    onRequestData: (
      handler: (
        ctx: unknown,
        chunk: Buffer,
        cb: (err: Error | null, chunk: Buffer) => void
      ) => void
    ) => void;
    onRequestEnd: (handler: (ctx: unknown, cb: () => void) => void) => void;
  }): Promise<void> {
    const req = ctx.clientToProxyRequest;
    const headers = normalizeHeaders(
      req.headers as Record<string, string | string[] | undefined>
    );
    const requestId = headers['x-request-id'] ?? headers['x-amzn-trace-id'];
    const authHeader = headers.authorization ?? headers.Authorization;
    const profileId = await this.extractProfileId(authHeader);

    const context: RequestContext = {
      profileId,
      workspacePath: null,
      authorization: authHeader,
    };

    if (requestId) {
      this.requestContext.set(requestId, context);
    }

    const method = req.method ?? 'GET';
    const url = req.url ?? '';
    const shouldExtractWorkspace =
      method === 'POST' && url.includes(BIDI_APPEND_PATH);

    if (!shouldExtractWorkspace) {
      return;
    }

    const bodyChunks: Buffer[] = [];
    ctx.onRequestData((_innerCtx, chunk, cb) => {
      bodyChunks.push(chunk);
      cb(null, chunk);
    });

    ctx.onRequestEnd(() => {
      void (async () => {
        const body = Buffer.concat(bodyChunks);
        if (body.length === 0) {
          return;
        }
        const workspacePath = await this.payloadExtractor.extractWorkspacePath(
          new Uint8Array(body),
          url,
          method
        );
        if (workspacePath && requestId) {
          const existing = this.requestContext.get(requestId) ?? context;
          existing.workspacePath = workspacePath;
          this.requestContext.set(requestId, existing);
        }
      })();
    });
  }

  private async routeAgentTraffic(summary: ProxyTrafficSummary): Promise<void> {
    if (!this.isAgentTraffic(summary)) {
      return;
    }

    const httpRequestId = summary.httpRequestId;
    const stored = httpRequestId
      ? this.requestContext.get(httpRequestId)
      : undefined;

    let profileId = stored?.profileId ?? null;
    let workspacePath = stored?.workspacePath ?? null;

    if (!profileId && stored?.authorization) {
      profileId = await this.extractProfileId(stored.authorization);
    }

    if (!workspacePath && profileId) {
      const workers = this.upstreamNotifier as UpstreamWorkerManager | null;
      const workerList = workers?.getWorkersByProfile(profileId) ?? [];
      if (workerList.length === 1) {
        workspacePath = workerList[0]!.workspacePath;
      }
    }

    if (!profileId || !workspacePath || !this.upstreamNotifier) {
      extensionLog.warn(
        `[MultiplexerMitmServer] Agent traffic without profile/workspace — skipped ` +
          `profile=${profileId ?? '(none)'} workspace=${workspacePath ?? '(none)'}`
      );
      return;
    }

    const upstreamId = UpstreamWorkerManager.buildUpstreamId(profileId, workspacePath);
    this.upstreamNotifier.notifyAgentTraffic(
      upstreamId,
      summary,
      profileId,
      workspacePath
    );

    if (httpRequestId) {
      this.requestContext.delete(httpRequestId);
    }
  }

  private isAgentTraffic(summary: ProxyTrafficSummary): boolean {
    const agent = summary.insights?.agent;
    return (
      summary.isLiveTokenUpdate === true ||
      summary.isTurnEnded === true ||
      agent?.usageEvent != null ||
      (summary.insights?.allTokenFrames?.length ?? 0) > 0
    );
  }

  private async extractProfileId(authHeader?: string): Promise<string | null> {
    if (!authHeader || !this.profileManager) {
      return null;
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return null;
    }

    const payload = decodeJwtPayload(token);
    if (!payload) {
      return null;
    }

    const email =
      typeof payload.email === 'string'
        ? payload.email
        : typeof payload.sub === 'string'
          ? payload.sub
          : null;

    if (!email) {
      return null;
    }

    const profile = await this.profileManager.findProfileByEmail(email);
    return profile?.id ?? null;
  }
}
