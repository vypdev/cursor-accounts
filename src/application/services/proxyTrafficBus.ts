import type { ProxyTrafficSummary } from '../types/proxyTraffic';
import type {
  IProxyTrafficBus,
  TrafficListener,
} from '../../domain/ports/IProxyTrafficBus';
import * as extensionLog from '../../logging/extensionLog';

export class ProxyTrafficBus implements IProxyTrafficBus {
  private readonly listeners: TrafficListener[] = [];

  constructor(
    private readonly enrich?: (
      summary: ProxyTrafficSummary
    ) => ProxyTrafficSummary
  ) {}

  publish(
    summary: ProxyTrafficSummary,
    profileId?: string,
    workspacePath?: string
  ): void {
    const enriched = this.enrich ? this.enrich(summary) : summary;

    for (const listener of this.listeners) {
      try {
        listener(enriched, profileId, workspacePath);
      } catch (error) {
        extensionLog.debug(
          `[Proxy] traffic listener error: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  subscribe(listener: TrafficListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) {
        this.listeners.splice(idx, 1);
      }
    };
  }
}
