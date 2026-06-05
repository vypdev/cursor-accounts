import { Proxy } from 'http-mitm-proxy';
import type { IProxyServer } from '../domain/ports/IProxyServer';
import { applyHttpolyglotHttpsPatch } from './httpolyglotHttpsPatch';
import { MitmProxyServer } from './mitmProxyServer';
/**
 * MITM proxy with HTTP/2 support via @httptoolkit/httpolyglot (ALPN h2 + HTTP/1.x).
 * Extends {@link MitmProxyServer} and patches HTTPS termination only.
 */
export class PolyglotMitmProxyServer extends MitmProxyServer implements IProxyServer {
  protected createMitmProxy(): Proxy {
    const proxy = new Proxy();
    applyHttpolyglotHttpsPatch(proxy);
    return proxy;
  }

}

/** Default production MITM implementation (HTTP/1.0, HTTP/1.1, HTTP/2). */
export function createDefaultMitmProxyServer(
  ...args: ConstructorParameters<typeof PolyglotMitmProxyServer>
): PolyglotMitmProxyServer {
  return new PolyglotMitmProxyServer(...args);
}

