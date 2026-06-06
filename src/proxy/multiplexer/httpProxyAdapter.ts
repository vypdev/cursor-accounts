import type { IncomingMessage, ServerResponse } from 'node:http';
import * as net from 'node:net';
import type { TunnelTarget } from './tcpTunnelAdapter';

/**
 * Forwards a plain HTTP request to an upstream MITM proxy via HTTP proxy protocol.
 */
export function forwardHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  target: TunnelTarget
): void {
  const proxyReq = net.connect(target.port, target.host, () => {
    const headerLines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`];
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null) {
        continue;
      }
      const normalized = Array.isArray(value) ? value.join(', ') : value;
      headerLines.push(`${key}: ${normalized}`);
    }
    headerLines.push('', '');
    proxyReq.write(headerLines.join('\r\n'));
    req.pipe(proxyReq);
  });

  proxyReq.on('data', (chunk) => res.write(chunk));
  proxyReq.on('end', () => res.end());
  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502);
    }
    res.end();
  });
}
