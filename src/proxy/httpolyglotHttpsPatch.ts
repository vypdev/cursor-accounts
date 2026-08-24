import * as httpolyglot from '@httptoolkit/httpolyglot';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Server as HttpsServer } from 'https';
import * as tls from 'tls';
import type { TlsOptions } from 'tls';
import type { Proxy } from 'http-mitm-proxy';
import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'net';
import { DEFAULT_ALPN_PROTOCOLS } from '../domain/types/httpProtocol';

type HttpsCreateCallback = (
  port: number,
  server: tls.Server,
  wssServer: WebSocketServer
) => void;

type MitmProxyWithHttpsFactory = Proxy & {
  _createHttpsServer: (
    options: TlsOptions & { hosts?: string[] },
    callback: HttpsCreateCallback
  ) => void;
  _onHttpServerRequest: (
    isSSL: boolean,
    clientToProxyRequest: IncomingMessage,
    proxyToClientResponse: ServerResponse
  ) => void;
  _onWebSocketServerConnect: (
    isSSL: boolean,
    ws: unknown,
    req: IncomingMessage
  ) => void;
  _onError: (
    errorKind: string,
    ctx: unknown,
    err: Error
  ) => void;
  timeout?: number;
  httpsPort?: number;
  httpHost?: string;
};

/**
 * Replaces http-mitm-proxy HTTPS servers with httpolyglot so ALPN can negotiate
 * HTTP/2 (h2) and HTTP/1.x on the same MITM port.
 *
 * Uses tls.createServer (not https.createServer) so Node does not attach an HTTP/1
 * parser to the TLS socket before httpolyglot routes by ALPN.
 */
export function applyHttpolyglotHttpsPatch(proxy: Proxy): void {
  const mitm = proxy as MitmProxyWithHttpsFactory;

  mitm._createHttpsServer = function (
    options: TlsOptions & { hosts?: string[] },
    callback: HttpsCreateCallback
  ): void {
    const { hosts: _hosts, ...tlsOpts } = options;
    void _hosts;

    const tlsServer = tls.createServer({
      ...tlsOpts,
      ALPNProtocols: [...DEFAULT_ALPN_PROTOCOLS],
    });

    tlsServer.on(
      'error',
      mitm._onError.bind(mitm, 'HTTPS_SERVER_ERROR', null)
    );
    tlsServer.on(
      'clientError',
      mitm._onError.bind(mitm, 'HTTPS_CLIENT_ERROR', null)
    );

    const requestListener = (
      clientToProxyRequest: IncomingMessage,
      proxyToClientResponse: ServerResponse
    ): void => {
      mitm._onHttpServerRequest(true, clientToProxyRequest, proxyToClientResponse);
    };

    const polyglotServer = httpolyglot.createServer(
      {
        tls: tlsServer,
        http2: {},
      },
      requestListener
    );

    if (mitm.timeout != null) {
      (polyglotServer as { timeout?: number }).timeout = mitm.timeout;
    }

    polyglotServer.on(
      'error',
      mitm._onError.bind(mitm, 'HTTPS_SERVER_ERROR', null)
    );

    // ws typings expect http/https.Server; TLS MITM leg is tls.Server at runtime.
    const wssServer = new WebSocketServer({
      server: tlsServer as unknown as HttpsServer,
    });
    wssServer.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      (ws as WebSocket & { upgradeReq?: IncomingMessage }).upgradeReq = req;
      mitm._onWebSocketServerConnect.call(mitm, true, ws, req);
    });

    const listenOptions: { port: number; host: string } = {
      port: 0,
      host: '0.0.0.0',
    };
    if (mitm.httpsPort && !options.hosts) {
      listenOptions.port = mitm.httpsPort;
    }
    if (mitm.httpHost) {
      listenOptions.host = mitm.httpHost;
    }

    polyglotServer.listen(listenOptions, () => {
      const address = polyglotServer.address() as AddressInfo | null;
      const port = address?.port ?? listenOptions.port;
      callback(port, tlsServer, wssServer);
    });
  };
}
