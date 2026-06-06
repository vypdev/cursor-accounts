import * as net from 'node:net';
import type { Socket } from 'node:net';

export interface TunnelTarget {
  host: string;
  port: number;
}

/**
 * Creates a TCP tunnel between client socket and upstream proxy.
 */
export function createConnectTunnel(
  clientSocket: Socket,
  head: Buffer,
  target: TunnelTarget,
  onClose?: (upstreamId?: string) => void
): void {
  const upstreamSocket = net.connect(target.port, target.host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) {
      upstreamSocket.write(head);
    }
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  const cleanup = () => {
    onClose?.();
    upstreamSocket.destroy();
    clientSocket.destroy();
  };

  upstreamSocket.on('error', cleanup);
  clientSocket.on('error', cleanup);
  upstreamSocket.on('close', () => clientSocket.end());
  clientSocket.on('close', () => upstreamSocket.end());
}
