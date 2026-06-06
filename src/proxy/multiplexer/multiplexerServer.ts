import * as http from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { Session } from '../../domain/entities/Session';
import type {
  IMultiplexerServer,
  RoutingHandler,
} from '../../domain/ports/IMultiplexerServer';
import type { RoutingContext } from '../../domain/ports/IRoutingStrategy';
import { forwardHttpRequest } from './httpProxyAdapter';
import { createConnectTunnel } from './tcpTunnelAdapter';

function normalizeHeaders(
  headers: IncomingMessage['headers']
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) {
      continue;
    }
    result[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

function sessionFromSocket(socket: Socket): Session {
  const sourceIp = socket.remoteAddress ?? '127.0.0.1';
  const sourcePort = socket.remotePort ?? 0;
  return new Session(sourceIp, sourcePort);
}

/** Node.js HTTP server implementing the multiplexor port. */
export class MultiplexerServer implements IMultiplexerServer {
  private server: http.Server | null = null;
  private handler: RoutingHandler | null = null;
  private listeningPort: number | undefined;

  async listen(
    port: number,
    host: string,
    handler: RoutingHandler
  ): Promise<void> {
    if (this.server) {
      return;
    }

    this.handler = handler;
    this.server = http.createServer((req, res) => {
      void this.handleHttp(req, res);
    });

    this.server.on('connect', (req, clientSocket, head) => {
      void this.handleConnect(req, clientSocket as Socket, head);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.listen(port, host, () => resolve());
      this.server?.once('error', reject);
    });

    this.listeningPort = port;
  }

  async close(): Promise<void> {
    if (!this.server) {
      return;
    }
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    this.server = null;
    this.handler = null;
    this.listeningPort = undefined;
  }

  isListening(): boolean {
    return this.server != null;
  }

  getPort(): number | undefined {
    return this.listeningPort;
  }

  private async handleConnect(
    req: IncomingMessage,
    clientSocket: Socket,
    head: Buffer
  ): Promise<void> {
    if (!this.handler) {
      clientSocket.end();
      return;
    }

    try {
      const session = sessionFromSocket(clientSocket);
      const context: RoutingContext = {
        url: req.url ?? undefined,
        method: 'CONNECT',
        headers: normalizeHeaders(req.headers),
      };
      const target = await this.handler(session, context);
      createConnectTunnel(
        clientSocket,
        head,
        { host: target.host, port: target.port },
        () => undefined
      );
    } catch {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.end();
    }
  }

  private async handleHttp(
    req: IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (!this.handler) {
      res.writeHead(503);
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      void this.finishHttp(req, res, Buffer.concat(chunks));
    });
    req.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(400);
      }
      res.end();
    });
  }

  private async finishHttp(
    req: IncomingMessage,
    res: http.ServerResponse,
    body: Buffer
  ): Promise<void> {
    if (!this.handler) {
      res.writeHead(503);
      res.end();
      return;
    }

    try {
      const socket = req.socket;
      const session = sessionFromSocket(socket);
      const context: RoutingContext = {
        url: req.url ?? undefined,
        method: req.method ?? undefined,
        headers: normalizeHeaders(req.headers),
        payload: body.length > 0 ? new Uint8Array(body) : undefined,
      };
      const target = await this.handler(session, context);
      forwardHttpRequest(req, res, {
        host: target.host,
        port: target.port,
      });
    } catch {
      res.writeHead(502);
      res.end();
    }
  }
}
