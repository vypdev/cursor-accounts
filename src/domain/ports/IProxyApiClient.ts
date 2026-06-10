import type { ProxyStatistics } from '@cursor-accounts/types';
import type {
  ProxyApiEvent,
  ProxyApiStatusResponse,
} from '../../application/types/proxyApi';

/** Port for extension-side consumption of the proxy localhost API. */
export interface IProxyApiClient {
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  getStatus(): Promise<ProxyApiStatusResponse>;
  getStats(): Promise<ProxyStatistics>;
  shutdown(): Promise<void>;
  onEvent(listener: (event: ProxyApiEvent) => void): () => void;
}
