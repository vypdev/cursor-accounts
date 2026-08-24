import type { ProxyApiEvent } from '../types/proxyApi';

export type ProxyEventListener = (event: ProxyApiEvent) => void;

/** Port for broadcasting proxy events to connected WebSocket clients. */
export interface IProxyEventBroadcaster {
  broadcast(event: ProxyApiEvent): void;
  getClientCount(): number;
}
