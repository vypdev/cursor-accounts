import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { ProxyApiEvent } from '../../application/types/proxyApi';
import type { IProxyEventBroadcaster } from '../../domain/ports/IProxyEventBroadcaster';
import { PROXY_API_PATHS } from '../../application/types/proxyApi';
import { isValidApiToken } from './middleware/localhostValidator';

const LOCALHOST_IPV4 = new Set(['127.0.0.1', '::ffff:127.0.0.1']);
const LOCALHOST_IPV6 = '::1';

function isLocalhostAddress(address: string | undefined): boolean {
  if (address == null) {
    return false;
  }
  return LOCALHOST_IPV4.has(address) || address === LOCALHOST_IPV6;
}

/**
 * WebSocket broadcaster for proxy events.
 * Accepts connections only from localhost on {@link PROXY_API_PATHS.ws}.
 */
export class ProxyWebSocketHandler implements IProxyEventBroadcaster {
  private readonly clients = new Set<WebSocket>();
  private readonly wss: WebSocketServer;

  constructor(server: Server, private readonly apiToken?: string) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = request.url ?? '';
      if (url !== PROXY_API_PATHS.ws && !url.startsWith(`${PROXY_API_PATHS.ws}?`)) {
        socket.destroy();
        return;
      }

      if (!isLocalhostAddress(request.socket.remoteAddress)) {
        socket.destroy();
        return;
      }

      if (!isValidApiToken(request.headers.authorization, this.apiToken)) {
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.on('close', () => {
        this.clients.delete(ws);
      });
      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });
  }

  broadcast(event: ProxyApiEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  close(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    this.wss.close();
  }
}
