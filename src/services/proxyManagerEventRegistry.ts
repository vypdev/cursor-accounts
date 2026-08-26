import type {
  ConversationUsagePersistedEvent,
  ConversationUsagePersistedListener,
  ProxyTrafficListener,
} from '../domain/ports/IProxyTraffic';
import type { TrafficListener } from '../domain/ports/IProxyTrafficBus';
import * as extensionLog from '../logging/extensionLog';

export interface ProxyManagerEventRegistryDependencies {
  subscribeTraffic(listener: TrafficListener): () => void;
  stopTrafficIngress(): void;
}

/** Owns facade listeners and their deterministic disposal order. */
export class ProxyManagerEventRegistry {
  private readonly statusCallbacks: Array<() => void> = [];
  private readonly usagePersistedListeners: ConversationUsagePersistedListener[] =
    [];
  private readonly trafficListenerUnsubscribers: Array<() => void> = [];
  private disposed = false;
  private unsubscribeTraffic: (() => void) | undefined;

  constructor(
    private readonly dependencies: ProxyManagerEventRegistryDependencies
  ) {}

  setTrafficHandler(
    handler: (summary: Parameters<TrafficListener>[0], profileId?: string) => Promise<void>
  ): void {
    if (this.unsubscribeTraffic) {
      throw new Error('Proxy traffic handler already configured');
    }
    this.unsubscribeTraffic = this.dependencies.subscribeTraffic(
      (summary, profileId) => {
        void handler(summary, profileId);
      }
    );
  }

  onStatusChange(callback: () => void): void {
    this.statusCallbacks.push(callback);
  }

  onTraffic(listener: ProxyTrafficListener): void {
    if (this.disposed) {
      return;
    }
    this.trafficListenerUnsubscribers.push(
      this.dependencies.subscribeTraffic(listener)
    );
  }

  onConversationUsagePersisted(
    listener: ConversationUsagePersistedListener
  ): void {
    this.usagePersistedListeners.push(listener);
  }

  notifyStatusChange(): void {
    for (const callback of this.statusCallbacks) {
      try {
        callback();
      } catch (error) {
        extensionLog.debug(
          `[Proxy] status callback error: ${extensionLog.formatError(error)}`
        );
      }
    }
  }

  notifyUsagePersisted(event: ConversationUsagePersistedEvent): void {
    for (const listener of this.usagePersistedListeners) {
      try {
        listener(event);
      } catch (error) {
        extensionLog.debug(
          `[Proxy] usage persisted listener error: ${extensionLog.formatError(error)}`
        );
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.unsubscribeTraffic?.();
    for (const unsubscribe of this.trafficListenerUnsubscribers) {
      unsubscribe();
    }
    this.trafficListenerUnsubscribers.length = 0;
    this.dependencies.stopTrafficIngress();
  }
}
