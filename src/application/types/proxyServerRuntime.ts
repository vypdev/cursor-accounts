import type { IProxyApiServer } from '../../domain/ports/IProxyApiServer';
import type { IProxyServer } from '../../domain/ports/IProxyServer';
import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';

/**
 * Runtime capabilities required by the proxy application coordinator.
 * Infrastructure implementations may expose additional capabilities, but
 * the coordinator depends only on this boundary.
 */
export interface ProxyRuntimeServer extends IProxyServer {
  on(event: 'error', listener: (error: unknown) => void): this;
  formatDiagnosticsLines(): string[];
}

/** Persistence boundary used by the standalone proxy process. */
export interface ProxyRuntimeTrackingIngress {
  enqueue(summary: ProxyTrafficSummary): Promise<void>;
  close(): Promise<void>;
}

/** Dependencies assembled by the infrastructure composition root. */
export interface ProxyServerRuntimeDependencies {
  apiServer: IProxyApiServer;
  proxyServer: ProxyRuntimeServer;
  trackingIngress?: ProxyRuntimeTrackingIngress;
  writeStderr(message: string): void;
  now(): string;
  onShutdownRequested?(shutdown: Promise<void>): void;
}
