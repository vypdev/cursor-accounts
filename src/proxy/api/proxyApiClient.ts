import type { ProxyStatistics } from '@cursor-accounts/types';
import type { IProxyApiClient } from '../../domain/ports/IProxyApiClient';
import {
  PROXY_API_PATHS,
  type ProxyApiEvent,
  type ProxyApiStatusResponse,
} from '../../application/types/proxyApi';
import { ProxyApiWebSocketTransport } from './proxyApiWebSocketTransport';

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export interface ProxyApiClientOptions {
  /** Base URL, e.g. http://127.0.0.1:18080 */
  baseUrl: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  apiToken?: string;
}

/**
 * Extension-side client for the proxy localhost API.
 * Consumes traffic and stats via WebSocket; uses REST for control queries.
 */
export class ProxyApiClient implements IProxyApiClient {
  private readonly webSocketTransport: ProxyApiWebSocketTransport;

  constructor(private readonly options: ProxyApiClientOptions) {
    this.webSocketTransport = new ProxyApiWebSocketTransport({
      baseUrl: this.baseUrl,
      connectTimeoutMs: options.connectTimeoutMs,
      reconnect: options.reconnect,
      maxReconnectAttempts: options.maxReconnectAttempts,
      apiToken: options.apiToken,
    });
  }

  get baseUrl(): string {
    return this.options.baseUrl.replace(/\/$/, '');
  }

  async connect(): Promise<void> {
    return this.webSocketTransport.connect();
  }

  disconnect(): void {
    this.webSocketTransport.disconnect();
  }

  isConnected(): boolean {
    return this.webSocketTransport.isConnected();
  }

  async getStatus(): Promise<ProxyApiStatusResponse> {
    const response = await this.request(PROXY_API_PATHS.status);
    if (!response.ok) {
      throw new Error(`Proxy API status failed: HTTP ${response.status}`);
    }
    return (await response.json()) as ProxyApiStatusResponse;
  }

  async getStats(): Promise<ProxyStatistics> {
    const response = await this.request(PROXY_API_PATHS.stats);
    if (!response.ok) {
      throw new Error(`Proxy API stats failed: HTTP ${response.status}`);
    }
    return (await response.json()) as ProxyStatistics;
  }

  async shutdown(): Promise<void> {
    const response = await this.request(PROXY_API_PATHS.shutdown, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Proxy API shutdown failed: HTTP ${response.status}`);
    }
  }

  onEvent(listener: (event: ProxyApiEvent) => void): () => void {
    return this.webSocketTransport.onEvent(listener);
  }

  private async request(pathname: string, init?: RequestInit): Promise<Response> {
    const timeoutMs =
      this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(`${this.baseUrl}${pathname}`, {
        ...init,
        headers: {
          ...this.authHeaders(),
          ...init?.headers,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Proxy API request timed out after ${timeoutMs}ms`, {
          cause: error,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private authHeaders(): Record<string, string> {
    return this.options.apiToken
      ? { authorization: `Bearer ${this.options.apiToken}` }
      : {};
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
