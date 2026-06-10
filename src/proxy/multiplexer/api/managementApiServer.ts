import type { IncomingMessage, ServerResponse } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import type { MetricsAggregator } from '../../../application/services/metricsAggregator';
import type { MultiplexerConfig } from '../../../application/types/multiplexerConfig';
import type { IUpstreamWorkerRegistry } from '../../../domain/ports/IUpstreamWorkerRegistry';
import type { ISessionStore } from '../../../domain/ports/ISessionStore';
import type { MultiplexerEventLogger } from '../multiplexerEventLogger';
import type {
  ConfigResponse,
  CreateUpstreamRequest,
  CreateUpstreamResponse,
  ErrorResponse,
  MetricsResponse,
  StatusResponse,
  UpstreamDto,
} from './apiTypes';
import type { WsNotification } from './wsNotifications';

const API_PREFIX = '/_api';

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(body));
}

function sendError(
  res: ServerResponse,
  statusCode: number,
  error: string,
  code?: string
): void {
  const payload: ErrorResponse = { error, ...(code ? { code } : {}) };
  sendJson(res, statusCode, payload);
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function workerToDto(
  worker: ReturnType<IUpstreamWorkerRegistry['getById']>
): UpstreamDto | null {
  if (!worker) {
    return null;
  }
  return {
    id: worker.id,
    healthy: worker.healthy,
    trafficReceived: worker.trafficReceived,
    metadata: {
      profileId: worker.profileId,
      workspacePath: worker.workspacePath,
    },
  };
}

/** HTTP/WebSocket management API served on `/_api/*` routes of the multiplexer. */
export class ManagementApiServer {
  private wsServer: WebSocketServer | null = null;
  private readonly wsClients = new Set<WebSocket>();
  private metricsBroadcastTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly workerRegistry: IUpstreamWorkerRegistry,
    private readonly upstreamWorkerManager: import('../upstreamWorkerManager').UpstreamWorkerManager,
    private readonly metricsAggregator: MetricsAggregator,
    private readonly sessionStore: ISessionStore,
    private getConfig: () => MultiplexerConfig | null,
    private readonly eventLogger?: MultiplexerEventLogger
  ) {}

  attachToHttpServer(
    server: import('node:http').Server,
    metricsBroadcastIntervalMs = 5000
  ): void {
    if (this.wsServer) {
      return;
    }

    const existingRequestListeners = server.listeners('request') as Array<
      (req: IncomingMessage, res: ServerResponse) => void
    >;
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      if (req.url?.startsWith(`${API_PREFIX}/`)) {
        void this.handleApiRequest(req, res);
        return;
      }

      for (const listener of existingRequestListeners) {
        listener.call(server, req, res);
      }
    });

    this.wsServer = new WebSocketServer({ noServer: true });

    const existingUpgradeListeners = server.listeners('upgrade') as Array<
      (
        req: IncomingMessage,
        socket: import('node:stream').Duplex,
        head: Buffer
      ) => void
    >;
    server.removeAllListeners('upgrade');
    server.on('upgrade', (req, socket, head) => {
      if (req.url === `${API_PREFIX}/ws`) {
        this.wsServer?.handleUpgrade(req, socket, head, (ws) => {
          this.wsServer?.emit('connection', ws, req);
        });
        return;
      }

      for (const listener of existingUpgradeListeners) {
        listener.call(server, req, socket, head);
      }
    });

    this.wsServer.on('connection', (ws) => {
      this.wsClients.add(ws);
      void this.eventLogger?.logApiWebSocketConnected(this.wsClients.size);

      ws.on('close', () => {
        this.wsClients.delete(ws);
        void this.eventLogger?.logApiWebSocketDisconnected(this.wsClients.size);
      });
    });

    if (this.metricsBroadcastTimer) {
      clearInterval(this.metricsBroadcastTimer);
    }
    this.metricsBroadcastTimer = setInterval(() => {
      this.notifyMetricsUpdated();
    }, metricsBroadcastIntervalMs);
  }

  dispose(): void {
    if (this.metricsBroadcastTimer) {
      clearInterval(this.metricsBroadcastTimer);
      this.metricsBroadcastTimer = undefined;
    }

    for (const client of this.wsClients) {
      client.close();
    }
    this.wsClients.clear();
    this.wsServer?.close();
    this.wsServer = null;
  }

  async handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    try {
      if (url.pathname === `${API_PREFIX}/health` && method === 'GET') {
        void this.eventLogger?.logApiRequest(url.pathname, method, 200);
        sendJson(res, 200, { status: 'ok' });
        return;
      }

      if (url.pathname === `${API_PREFIX}/status` && method === 'GET') {
        await this.handleStatus(res);
        void this.eventLogger?.logApiRequest(url.pathname, method, 200);
        return;
      }

      if (url.pathname === `${API_PREFIX}/metrics` && method === 'GET') {
        await this.handleMetrics(res);
        void this.eventLogger?.logApiRequest(url.pathname, method, 200);
        return;
      }

      if (url.pathname === `${API_PREFIX}/upstreams` && method === 'GET') {
        await this.handleGetUpstreams(url, res);
        void this.eventLogger?.logApiRequest(url.pathname, method, 200);
        return;
      }

      if (url.pathname === `${API_PREFIX}/upstreams` && method === 'POST') {
        await this.handleCreateUpstream(req, res);
        return;
      }

      const upstreamMatch = url.pathname.match(
        new RegExp(`^${API_PREFIX}/upstreams/([^/]+)$`)
      );
      if (upstreamMatch && method === 'DELETE') {
        await this.handleDeleteUpstream(upstreamMatch[1]!, res);
        return;
      }

      const profileMatch = url.pathname.match(
        new RegExp(`^${API_PREFIX}/upstreams/profile/([^/]+)$`)
      );
      if (profileMatch && method === 'DELETE') {
        await this.handleDeleteUpstreamsForProfile(profileMatch[1]!, res);
        return;
      }

      if (url.pathname === `${API_PREFIX}/sessions` && method === 'GET') {
        await this.handleSessions(res);
        void this.eventLogger?.logApiRequest(url.pathname, method, 200);
        return;
      }

      if (url.pathname === `${API_PREFIX}/config` && method === 'GET') {
        await this.handleConfig(res);
        void this.eventLogger?.logApiRequest(url.pathname, method, 200);
        return;
      }

      void this.eventLogger?.logApiRequest(url.pathname, method, 404);
      sendError(res, 404, 'Not found');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void this.eventLogger?.logApiError(url.pathname, message);
      void this.eventLogger?.logApiRequest(url.pathname, method, 500);
      sendError(res, 500, message);
    }
  }

  notifyUpstreamCreated(
    upstreamId: string,
    profileId: string,
    workspacePath: string
  ): void {
    this.broadcast({
      type: 'upstream_created',
      timestamp: new Date().toISOString(),
      data: { upstreamId, profileId, workspacePath },
    });
    this.notifyStatusChanged();
  }

  notifyUpstreamStopped(upstreamId: string, reason?: string): void {
    this.broadcast({
      type: 'upstream_stopped',
      timestamp: new Date().toISOString(),
      data: { upstreamId, ...(reason ? { reason } : {}) },
    });
    this.notifyStatusChanged();
  }

  notifyMetricsUpdated(): void {
    const view = this.metricsAggregator.getView();
    this.broadcast({
      type: 'metrics_updated',
      timestamp: new Date().toISOString(),
      data: { metrics: view.snapshot },
    });
  }

  notifyStatusChanged(): void {
    const config = this.getConfig();
    this.broadcast({
      type: 'status_changed',
      timestamp: new Date().toISOString(),
      data: {
        running: config != null,
        upstreamCount: this.workerRegistry.getAll().length,
      },
    });
  }

  notifyConfigChanged(): void {
    const config = this.getConfig();
    if (!config) {
      return;
    }
    this.broadcast({
      type: 'config_changed',
      timestamp: new Date().toISOString(),
      data: { strategy: config.routing.strategy },
    });
  }

  private handleStatus(res: ServerResponse): void {
    const config = this.getConfig();
    if (!config) {
      sendError(res, 503, 'Multiplexer is not running', 'NOT_RUNNING');
      return;
    }

    const metrics = this.metricsAggregator.getView();
    const response: StatusResponse = {
      running: true,
      port: config.router.port,
      strategy: config.routing.strategy,
      activeSessions: metrics.snapshot.activeSessions,
      upstreamCount: this.workerRegistry.getAll().length,
    };
    sendJson(res, 200, response);
  }

  private handleMetrics(res: ServerResponse): void {
    const config = this.getConfig();
    if (!config) {
      sendError(res, 503, 'Multiplexer is not running', 'NOT_RUNNING');
      return;
    }

    const view = this.metricsAggregator.getView();
    const response: MetricsResponse = {
      snapshot: view.snapshot,
      generatedAt: view.generatedAt,
      routerPort: view.routerPort ?? config.router.port,
      strategy: view.strategy ?? config.routing.strategy,
    };
    sendJson(res, 200, response);
  }

  private handleGetUpstreams(url: URL, res: ServerResponse): void {
    const profileId = url.searchParams.get('profileId') ?? undefined;
    const workers = profileId
      ? this.workerRegistry.listByProfile(profileId)
      : this.workerRegistry.getAll();

    const dtos = workers.map((worker) => workerToDto(worker)!);
    sendJson(res, 200, dtos);
  }

  private async handleCreateUpstream(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = await readJsonBody<CreateUpstreamRequest>(req);
    if (!body?.profileId || !body.workspacePath) {
      void this.eventLogger?.logApiRequest(`${API_PREFIX}/upstreams`, 'POST', 400);
      sendError(res, 400, 'profileId and workspacePath are required', 'INVALID_BODY');
      return;
    }

    try {
      const userDataDir = body.userDataDir ?? '';
      const upstreamId = await this.upstreamWorkerManager.createWorker(
        body.profileId,
        body.workspacePath,
        userDataDir
      );
      const response: CreateUpstreamResponse = { upstreamId };
      void this.eventLogger?.logApiRequest(`${API_PREFIX}/upstreams`, 'POST', 201);
      
      this.notifyUpstreamCreated(upstreamId, body.profileId, body.workspacePath);
      sendJson(res, 201, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void this.eventLogger?.logApiError(`${API_PREFIX}/upstreams`, message);
      void this.eventLogger?.logApiRequest(`${API_PREFIX}/upstreams`, 'POST', 500);
      sendError(res, 500, message);
    }
  }

  private async handleDeleteUpstream(
    upstreamId: string,
    res: ServerResponse
  ): Promise<void> {
    const decodedId = decodeURIComponent(upstreamId);

    try {
      await this.upstreamWorkerManager.stopWorker(decodedId);
      void this.eventLogger?.logApiRequest(
        `${API_PREFIX}/upstreams/${decodedId}`,
        'DELETE',
        204
      );
      
      this.notifyUpstreamStopped(decodedId);
      res.writeHead(204);
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void this.eventLogger?.logApiError(`${API_PREFIX}/upstreams/${decodedId}`, message);
      void this.eventLogger?.logApiRequest(
        `${API_PREFIX}/upstreams/${decodedId}`,
        'DELETE',
        500
      );
      sendError(res, 500, message);
    }
  }

  private async handleDeleteUpstreamsForProfile(
    profileId: string,
    res: ServerResponse
  ): Promise<void> {
    const decodedProfileId = decodeURIComponent(profileId);

    try {
      await this.upstreamWorkerManager.stopWorkersForProfile(decodedProfileId);
      void this.eventLogger?.logApiRequest(
        `${API_PREFIX}/upstreams/profile/${decodedProfileId}`,
        'DELETE',
        204
      );
      res.writeHead(204);
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void this.eventLogger?.logApiError(
        `${API_PREFIX}/upstreams/profile/${decodedProfileId}`,
        message
      );
      void this.eventLogger?.logApiRequest(
        `${API_PREFIX}/upstreams/profile/${decodedProfileId}`,
        'DELETE',
        500
      );
      sendError(res, 500, message);
    }
  }

  private handleSessions(res: ServerResponse): void {
    const sessions = this.sessionStore.list().map((binding) => ({
      ...binding,
      assignedAt:
        binding.assignedAt instanceof Date
          ? binding.assignedAt.toISOString()
          : binding.assignedAt,
    }));
    sendJson(res, 200, sessions);
  }

  private handleConfig(res: ServerResponse): void {
    const config = this.getConfig();
    if (!config) {
      sendError(res, 503, 'Multiplexer is not running', 'NOT_RUNNING');
      return;
    }

    const response: ConfigResponse = {
      router: {
        host: config.router.host,
        port: config.router.port,
      },
      routing: {
        strategy: config.routing.strategy,
        ...(config.routing.fallbackStrategy
          ? { fallbackStrategy: config.routing.fallbackStrategy }
          : {}),
        ...(config.routing.sessionTimeoutMs != null
          ? { sessionTimeoutMs: config.routing.sessionTimeoutMs }
          : {}),
      },
    };
    sendJson(res, 200, response);
  }

  private broadcast(notification: WsNotification): void {
    const message = JSON.stringify(notification);
    for (const client of this.wsClients) {
      if (client.readyState === client.OPEN) {
        try {
          client.send(message);
        } catch {
          // Ignore send failures for individual clients.
        }
      }
    }
  }
}
