import WebSocket from 'ws';
import type { ProxyStatistics } from '@cursor-accounts/types';
import type { IProxyApiClient } from '../../domain/ports/IProxyApiClient';
import {
  PROXY_API_PATHS,
  type ProxyApiEvent,
  type ProxyApiStatusResponse,
} from '../../application/types/proxyApi';

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_ATTEMPTS = 5;

export interface ProxyApiClientOptions {
  /** Base URL, e.g. http://127.0.0.1:18080 */
  baseUrl: string;
  connectTimeoutMs?: number;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  apiToken?: string;
}

/**
 * Extension-side client for the proxy localhost API.
 * Consumes traffic and stats via WebSocket; uses REST for control queries.
 */
export class ProxyApiClient implements IProxyApiClient {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<(event: ProxyApiEvent) => void>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false;

  constructor(private readonly options: ProxyApiClientOptions) {}

  get baseUrl(): string {
    return this.options.baseUrl.replace(/\/$/, '');
  }

  async connect(): Promise<void> {
    this.intentionalDisconnect = false;
    try {
      await this.connectWebSocket();
    } catch (error) {
      // A failed initial connection must not leave an orphaned reconnect loop
      // when the caller does not retain the client instance.
      this.disconnect();
      throw error;
    }
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.removeAllListeners();
    this.ws?.close();
    this.ws = null;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async getStatus(): Promise<ProxyApiStatusResponse> {
    const response = await fetch(`${this.baseUrl}${PROXY_API_PATHS.status}`, {
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Proxy API status failed: HTTP ${response.status}`);
    }
    return (await response.json()) as ProxyApiStatusResponse;
  }

  async getStats(): Promise<ProxyStatistics> {
    const response = await fetch(`${this.baseUrl}${PROXY_API_PATHS.stats}`, {
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Proxy API stats failed: HTTP ${response.status}`);
    }
    return (await response.json()) as ProxyStatistics;
  }

  async shutdown(): Promise<void> {
    const response = await fetch(`${this.baseUrl}${PROXY_API_PATHS.shutdown}`, {
      method: 'POST',
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Proxy API shutdown failed: HTTP ${response.status}`);
    }
  }

  onEvent(listener: (event: ProxyApiEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async connectWebSocket(): Promise<void> {
    const wsUrl = `${this.baseUrl.replace(/^http/i, 'ws')}${PROXY_API_PATHS.ws}`;
    const timeoutMs = this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: this.authHeaders(),
      });
      this.ws = ws;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`WebSocket connect timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      ws.once('open', () => {
        clearTimeout(timeout);
        this.reconnectAttempts = 0;
        resolve();
      });

      ws.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      ws.on('message', (data) => {
        try {
          const payload = Buffer.isBuffer(data)
            ? data.toString('utf8')
            : typeof data === 'string'
              ? data
              : JSON.stringify(data);
          const event = JSON.parse(payload) as ProxyApiEvent;
          for (const listener of this.listeners) {
            listener(event);
          }
        } catch {
          // Ignore malformed frames.
        }
      });

      ws.on('close', () => {
        this.ws = null;
        this.scheduleReconnect();
      });
    });
  }

  private authHeaders(): Record<string, string> {
    return this.options.apiToken
      ? { authorization: `Bearer ${this.options.apiToken}` }
      : {};
  }

  private scheduleReconnect(): void {
    if (this.intentionalDisconnect || this.options.reconnect === false) {
      return;
    }

    const maxAttempts =
      this.options.maxReconnectAttempts ?? MAX_RECONNECT_ATTEMPTS;
    if (this.reconnectAttempts >= maxAttempts) {
      return;
    }

    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      void this.connectWebSocket().catch(() => {
        this.scheduleReconnect();
      });
    }, RECONNECT_DELAY_MS);
  }
}

/** Build the default API base URL from the API port. */
export function buildProxyApiBaseUrl(apiPort: number): string {
  return `http://127.0.0.1:${apiPort}`;
}

/** Resolve API port from MITM port and optional persisted value. */
export function resolveProxyApiPort(
  mitmPort: number,
  apiPortOffset: number,
  persistedApiPort?: number
): number {
  return persistedApiPort ?? mitmPort + apiPortOffset;
}
