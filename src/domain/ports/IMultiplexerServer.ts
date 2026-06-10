import type { ProxyServerConfig } from '../../application/types/proxyConfig';

/**
 * Port: global multiplexor MITM listener (Infrastructure implementations).
 */
export interface IMultiplexerServer {
  start(config: ProxyServerConfig): Promise<void>;
  stop(): Promise<void>;
  close(): Promise<void>;
  isListening(): boolean;
  getPort(): number | undefined;
}
