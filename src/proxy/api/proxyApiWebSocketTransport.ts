import WebSocket from 'ws';
import type { ProxyApiEvent } from '../../application/types/proxyApi';

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_ATTEMPTS = 5;

export interface ProxyApiWebSocketTransportOptions {
  baseUrl: string;
  connectTimeoutMs?: number;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  apiToken?: string;
}

type ProxyApiEventListener = (event: ProxyApiEvent) => void;

/**
 * Infrastructure adapter for the proxy event WebSocket.
 * Owns connection state, bounded initial connection, and reconnection policy.
 */
export class ProxyApiWebSocketTransport {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<ProxyApiEventListener>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false;
  private connectPromise: Promise<void> | null = null;

  constructor(private readonly options: ProxyApiWebSocketTransportOptions) {}

  async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.intentionalDisconnect = false;
    this.connectPromise = this.connectWebSocket()
      .catch((error: unknown) => {
        // A failed initial connection must not leave an orphaned reconnect loop
        // when the caller does not retain the transport instance.
        this.disconnect();
        throw error;
      })
      .finally(() => {
        this.connectPromise = null;
      });
    return this.connectPromise;
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

  onEvent(listener: ProxyApiEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async connectWebSocket(): Promise<void> {
    const wsUrl = `${this.options.baseUrl.replace(/^http/i, 'ws')}/ws`;
    const timeoutMs = this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: this.authHeaders(),
      });
      this.ws = ws;
      let opened = false;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`WebSocket connect timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      ws.once('open', () => {
        clearTimeout(timeout);
        opened = true;
        this.reconnectAttempts = 0;
        resolve();
      });

      ws.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      ws.on('message', (data) => {
        const event = parseProxyApiEvent(data);
        if (!event) {
          return;
        }

        for (const listener of this.listeners) {
          try {
            listener(event);
          } catch {
            // An extension listener must not prevent other listeners from
            // receiving the same proxy event.
          }
        }
      });

      ws.on('close', () => {
        if (this.ws === ws) {
          this.ws = null;
          if (opened) {
            this.scheduleReconnect();
          }
        }
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
    const delayMs = this.options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectWebSocket().catch(() => {
        this.scheduleReconnect();
      });
    }, delayMs);
  }
}

function parseProxyApiEvent(data: WebSocket.RawData): ProxyApiEvent | null {
  try {
    const payload = Buffer.isBuffer(data)
      ? data.toString('utf8')
      : typeof data === 'string'
        ? data
        : JSON.stringify(data);
    return JSON.parse(payload) as ProxyApiEvent;
  } catch {
    // Ignore malformed frames from the local transport.
    return null;
  }
}
