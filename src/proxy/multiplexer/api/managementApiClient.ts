import WebSocket from 'ws';
import type { MultiplexerMetricsView } from '../../../application/types/multiplexerMetrics';
import type { SessionBinding } from '../../../domain/ports/ISessionStore';
import type { RoutingStrategyName } from '../../../domain/types/multiplexerTypes';
import { GLOBAL_MULTIPLEXER_PORT } from '../../../application/types/multiplexerConfig';
import type {
  ConfigResponse,
  CreateUpstreamResponse,
  ErrorResponse,
  MetricsResponse,
  StatusResponse,
  UpstreamDto,
} from './apiTypes';
import type {
  MetricsUpdatedData,
  StatusChangedData,
  UpstreamCreatedData,
  UpstreamStoppedData,
  WsNotification,
  WsNotificationType,
} from './wsNotifications';

const DEFAULT_TIMEOUT_MS = 5000;
const WS_RECONNECT_MS = 5000;
const MAX_RETRIES = 3;

interface ApiClientCache {
  status: StatusResponse | null;
  metrics: MetricsResponse | null;
  upstreams: UpstreamDto[];
  sessions: SessionBinding[];
  config: ConfigResponse | null;
}

/** HTTP/WebSocket client for the multiplexer management API. */
export class ManagementApiClient {
  private wsClient: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private readonly cache: ApiClientCache = {
    status: null,
    metrics: null,
    upstreams: [],
    sessions: [],
    config: null,
  };
  private readonly listeners = new Map<
    WsNotificationType,
    Set<(data: unknown) => void>
  >();

  constructor(
    private readonly baseUrl = `http://127.0.0.1:${GLOBAL_MULTIPLEXER_PORT}`
  ) {}

  connectWebSocket(): void {
    if (this.disposed || this.wsClient) {
      return;
    }

    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/_api/ws';
    this.wsClient = new WebSocket(wsUrl);

    this.wsClient.on('message', (data) => {
      try {
        const notification = JSON.parse(String(data)) as WsNotification;
        this.handleNotification(notification);
      } catch {
        // Ignore malformed notifications.
      }
    });

    this.wsClient.on('close', () => {
      this.wsClient = null;
      if (!this.disposed) {
        this.reconnectTimer = setTimeout(() => this.connectWebSocket(), WS_RECONNECT_MS);
      }
    });

    this.wsClient.on('error', () => {
      this.wsClient?.close();
    });
  }

  waitForWebSocketOpen(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    if (this.wsClient?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    const client = this.wsClient;
    if (!client) {
      return Promise.reject(new Error('WebSocket is not connected'));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('WebSocket open timeout'));
      }, timeoutMs);

      client.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      client.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  disconnect(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
  }

  onNotification<T>(
    type: WsNotificationType,
    handler: (data: T) => void
  ): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    const handlers = this.listeners.get(type)!;
    handlers.add(handler as (data: unknown) => void);
    return () => {
      handlers.delete(handler as (data: unknown) => void);
    };
  }

  getCachedStatus(): StatusResponse | null {
    return this.cache.status;
  }

  getCachedMetrics(): MetricsResponse | null {
    return this.cache.metrics;
  }

  getCachedUpstreams(): readonly UpstreamDto[] {
    return this.cache.upstreams;
  }

  getCachedSessions(): readonly SessionBinding[] {
    return this.cache.sessions;
  }

  async getHealth(): Promise<boolean> {
    try {
      const response = await this.fetchWithRetry('/_api/health');
      return response.ok;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<StatusResponse> {
    const response = await this.fetchWithRetry('/_api/status');
    await this.ensureOk(response);
    const data = (await response.json()) as StatusResponse;
    this.cache.status = data;
    return data;
  }

  async getMetrics(): Promise<MetricsResponse> {
    const response = await this.fetchWithRetry('/_api/metrics');
    await this.ensureOk(response);
    const data = (await response.json()) as MetricsResponse;
    this.cache.metrics = data;
    return data;
  }

  async getUpstreams(profileId?: string): Promise<UpstreamDto[]> {
    const path = profileId
      ? `/_api/upstreams?profileId=${encodeURIComponent(profileId)}`
      : '/_api/upstreams';
    const response = await this.fetchWithRetry(path);
    await this.ensureOk(response);
    const data = (await response.json()) as UpstreamDto[];
    this.cache.upstreams = data;
    return data;
  }

  async getSessions(): Promise<SessionBinding[]> {
    const response = await this.fetchWithRetry('/_api/sessions');
    await this.ensureOk(response);
    const raw = (await response.json()) as Array<
      Omit<SessionBinding, 'assignedAt'> & { assignedAt: string }
    >;
    const sessions = raw.map((binding) => ({
      ...binding,
      assignedAt: new Date(binding.assignedAt),
    }));
    this.cache.sessions = sessions;
    return sessions;
  }

  async getConfig(): Promise<ConfigResponse> {
    const response = await this.fetchWithRetry('/_api/config');
    await this.ensureOk(response);
    const data = (await response.json()) as ConfigResponse;
    this.cache.config = data;
    return data;
  }

  async createUpstream(
    profileId: string,
    workspacePath: string,
    userDataDir?: string
  ): Promise<CreateUpstreamResponse> {
    const body: { profileId: string; workspacePath: string; userDataDir?: string } = {
      profileId,
      workspacePath,
    };
    if (userDataDir) {
      body.userDataDir = userDataDir;
    }

    const response = await this.fetchWithRetry('/_api/upstreams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = (await response.json()) as ErrorResponse;
      throw new Error(error.error);
    }
    return response.json() as Promise<CreateUpstreamResponse>;
  }

  async deleteUpstream(upstreamId: string): Promise<void> {
    const response = await this.fetchWithRetry(
      `/_api/upstreams/${encodeURIComponent(upstreamId)}`,
      { method: 'DELETE' }
    );
    if (!response.ok && response.status !== 204) {
      const error = (await response.json()) as ErrorResponse;
      throw new Error(error.error);
    }
  }

  async deleteUpstreamsByProfile(profileId: string): Promise<void> {
    const response = await this.fetchWithRetry(
      `/_api/upstreams/profile/${encodeURIComponent(profileId)}`,
      { method: 'DELETE' }
    );
    if (!response.ok && response.status !== 204) {
      const error = (await response.json()) as ErrorResponse;
      throw new Error(error.error);
    }
  }

  toMetricsView(response: MetricsResponse): MultiplexerMetricsView {
    return {
      snapshot: response.snapshot,
      generatedAt: response.generatedAt,
      routerPort: response.routerPort,
      strategy: response.strategy,
    };
  }

  private async fetchWithRetry(
    path: string,
    init?: RequestInit,
    attempt = 0
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (attempt + 1 >= MAX_RETRIES) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      return this.fetchWithRetry(path, init, attempt + 1);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async ensureOk(response: Response): Promise<void> {
    if (response.ok) {
      return;
    }
    let message = response.statusText;
    try {
      const error = (await response.json()) as ErrorResponse;
      message = error.error;
    } catch {
      // Keep status text fallback.
    }
    throw new Error(`API error: ${message}`);
  }

  private handleNotification(notification: WsNotification): void {
    const handlers = this.listeners.get(notification.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(notification.data);
        } catch {
          // Ignore listener errors.
        }
      }
    }

    switch (notification.type) {
      case 'metrics_updated': {
        const data = notification.data as MetricsUpdatedData;
        if (this.cache.metrics) {
          this.cache.metrics = {
            ...this.cache.metrics,
            snapshot: data.metrics,
            generatedAt: notification.timestamp,
          };
        }
        break;
      }
      case 'status_changed': {
        const data = notification.data as StatusChangedData;
        if (this.cache.status) {
          this.cache.status = {
            ...this.cache.status,
            running: data.running,
            upstreamCount: data.upstreamCount,
          };
        }
        break;
      }
      case 'upstream_created': {
        const data = notification.data as UpstreamCreatedData;
        this.cache.upstreams = [
          ...this.cache.upstreams.filter((u) => u.id !== data.upstreamId),
          {
            id: data.upstreamId,
            healthy: true,
            trafficReceived: 0,
            metadata: {
              profileId: data.profileId,
              workspacePath: data.workspacePath,
            },
          },
        ];
        break;
      }
      case 'upstream_stopped': {
        const data = notification.data as UpstreamStoppedData;
        this.cache.upstreams = this.cache.upstreams.filter(
          (u) => u.id !== data.upstreamId
        );
        break;
      }
      case 'config_changed':
        break;
      default:
        break;
    }
  }
}

export function mapStrategyName(
  strategy: string | undefined
): RoutingStrategyName | undefined {
  if (strategy === 'workspace-path' || strategy === 'sticky-session') {
    return strategy;
  }
  return undefined;
}
