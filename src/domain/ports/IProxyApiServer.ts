import type { ProxyStatistics } from '@cursor-accounts/types';
import type {
  ProxyApiEvent,
  ProxyApiServerOptions,
  ProxyApiStatusResponse,
} from '../../application/types/proxyApi';

/** Port for the localhost HTTP/WebSocket control plane exposed by the proxy child process. */
export interface IProxyApiServer {
  start(options: ProxyApiServerOptions): Promise<void>;
  stop(): Promise<void>;
  broadcast(event: ProxyApiEvent): void;
  isRunning(): boolean;
  getApiPort(): number | null;
  getStatus(): ProxyApiStatusResponse;
  getStatistics(): ProxyStatistics;
  requestShutdown(): void;
}
