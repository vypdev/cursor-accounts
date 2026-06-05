import type { ProxyTrafficSummary } from '../../application/types/proxyTraffic';

export type TrafficListener = (
  summary: ProxyTrafficSummary,
  profileId?: string
) => void;

export interface IProxyTrafficBus {
  publish(summary: ProxyTrafficSummary, profileId?: string): void;
  subscribe(listener: TrafficListener): () => void;
}
