import type { ProxyStatistics } from '@cursor-accounts/types';
import type { ProxyServerConfig } from '../types/proxyConfig';

/**
 * MITM proxy lifecycle (Infrastructure implementations).
 */
export interface IProxyServer {
  start(config: ProxyServerConfig): Promise<void>;
  stop(): Promise<void>;
  getStatistics(): ProxyStatistics;
}
