import http from 'http';
import express from 'express';
import type { ProxyStatistics } from '@cursor-accounts/types';
import type { IProxyApiServer } from '../../domain/ports/IProxyApiServer';
import type {
  ProxyApiEvent,
  ProxyApiServerOptions,
  ProxyApiStatusResponse,
} from '../../application/types/proxyApi';
import { localhostOnly } from './middleware/localhostValidator';
import { apiErrorHandler } from './middleware/errorHandler';
import { registerProxyApiRoutes } from './proxyApiRoutes';
import { ProxyWebSocketHandler } from './proxyWebSocketHandler';

const API_SHUTDOWN_GRACE_MS = 2_000;

/**
 * Localhost HTTP + WebSocket control plane for the MITM proxy child process.
 * Runs on a dedicated API port (separate from the MITM listen port).
 */
export class ProxyApiServer implements IProxyApiServer {
  private app: express.Express | null = null;
  private httpServer: http.Server | null = null;
  private wsHandler: ProxyWebSocketHandler | null = null;
  private options: ProxyApiServerOptions | null = null;
  private routeContext: ReturnType<typeof registerProxyApiRoutes> | null = null;

  async start(options: ProxyApiServerOptions): Promise<void> {
    if (this.httpServer) {
      return;
    }

    this.options = options;
    this.app = express();
    this.app.use(express.json({ limit: '256kb' }));
    this.app.use(localhostOnly);

    this.routeContext = registerProxyApiRoutes(this.app, options);
    this.app.use(apiErrorHandler);

    this.httpServer = http.createServer(this.app);
    this.wsHandler = new ProxyWebSocketHandler(this.httpServer);

    await new Promise<void>((resolve, reject) => {
      this.httpServer?.once('error', reject);
      this.httpServer?.listen(options.apiPort, '127.0.0.1', () => {
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.wsHandler?.close();
    this.wsHandler = null;

    const server = this.httpServer;
    this.httpServer = null;
    this.app = null;
    this.routeContext = null;
    this.options = null;

    if (!server) {
      return;
    }

    await Promise.race([
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
      new Promise<void>((resolve) => {
        setTimeout(resolve, API_SHUTDOWN_GRACE_MS);
      }),
    ]);
  }

  broadcast(event: ProxyApiEvent): void {
    this.wsHandler?.broadcast(event);
  }

  isRunning(): boolean {
    return this.httpServer != null;
  }

  getApiPort(): number | null {
    return this.options?.apiPort ?? null;
  }

  getStatus(): ProxyApiStatusResponse {
    if (this.routeContext) {
      return this.routeContext.getStatus();
    }

    return {
      running: false,
      mitmPort: this.options?.mitmPort ?? 0,
      apiPort: this.options?.apiPort ?? 0,
    };
  }

  getStatistics(): ProxyStatistics {
    return this.routeContext?.getStatistics() ?? this.options?.getStatistics() ?? {
      totalRequests: 0,
      cursorRequests: 0,
      bytesTransferred: 0,
      activeConnections: 0,
    };
  }

  requestShutdown(): void {
    this.routeContext?.requestShutdown();
  }
}
