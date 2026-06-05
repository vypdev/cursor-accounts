import type { EventEmitter } from 'events';
import type { ProxyStatistics } from '@cursor-accounts/types';
import type { ProxyServerConfig } from '../../application/types/proxyConfig';

/**
 * MITM proxy lifecycle (Infrastructure implementations).
 */
export interface IProxyServer extends EventEmitter {
  start(config: ProxyServerConfig): Promise<void>;
  stop(): Promise<void>;
  getStatistics(): ProxyStatistics;
}
