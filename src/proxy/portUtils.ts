import * as net from 'net';
import { PROXY_PORT_FALLBACKS } from './types';

/**
 * Returns true if the TCP port is free on localhost.
 */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Pick the first available port from preferred list or the requested port.
 */
export async function resolveAvailablePort(
  preferredPort: number
): Promise<number | null> {
  const candidates = [
    preferredPort,
    ...PROXY_PORT_FALLBACKS.filter((p) => p !== preferredPort),
  ];

  for (const port of candidates) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  return null;
}

/**
 * Returns true if a process with the given PID appears to be running.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
