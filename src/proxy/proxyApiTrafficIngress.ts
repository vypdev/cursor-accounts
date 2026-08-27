import type { ProxyStatistics } from '@cursor-accounts/types';
import type { IProxyApiClient } from '../domain/ports/IProxyApiClient';
import type { ProxyApiEvent } from '../domain/types/proxyApi';
import type { ProxyTrafficSummary } from '../domain/types/proxyTraffic';
import {
  buildProxyApiBaseUrl,
  type ProxyApiClientOptions,
} from './api/proxyApiClient';

export interface ProxyApiTrafficIngressDependencies {
  createApiClient(options: ProxyApiClientOptions): IProxyApiClient;
  publishTraffic(summary: ProxyTrafficSummary, profileId: string): void;
  onStats?(profileId: string, stats: ProxyStatistics): void;
  onDiagnostics?(profileId: string, lines: string[]): void;
}

/** Owns API/WebSocket traffic subscriptions independently from JSONL tailing. */
export class ProxyApiTrafficIngress {
  private readonly apiClients = new Map<string, IProxyApiClient>();
  private readonly apiUnsubscribers = new Map<string, () => void>();

  constructor(
    private readonly dependencies: ProxyApiTrafficIngressDependencies
  ) {}

  async start(
    profileId: string,
    apiPort: number,
    forceRestart: boolean,
    apiToken?: string
  ): Promise<void> {
    const existing = this.apiClients.get(profileId);
    if (existing?.isConnected() && !forceRestart) {
      return;
    }

    this.stop(profileId);
    const client = this.dependencies.createApiClient({
      baseUrl: buildProxyApiBaseUrl(apiPort),
      reconnect: true,
      apiToken,
    });
    const unsubscribe = client.onEvent((event) => {
      publishApiEvent(this.dependencies, event, profileId);
    });

    try {
      await client.connect();
    } catch (error) {
      unsubscribe();
      client.disconnect();
      throw error;
    }
    this.apiClients.set(profileId, client);
    this.apiUnsubscribers.set(profileId, unsubscribe);
  }

  stop(profileId: string): void {
    this.apiUnsubscribers.get(profileId)?.();
    this.apiUnsubscribers.delete(profileId);
    this.apiClients.get(profileId)?.disconnect();
    this.apiClients.delete(profileId);
  }

  stopAll(): void {
    for (const profileId of [...this.apiClients.keys()]) {
      this.stop(profileId);
    }
  }

  isRunning(profileId: string): boolean {
    return this.apiClients.get(profileId)?.isConnected() === true;
  }

  getClient(profileId: string): IProxyApiClient | undefined {
    return this.apiClients.get(profileId);
  }

}

function publishApiEvent(
  dependencies: ProxyApiTrafficIngressDependencies,
  event: ProxyApiEvent,
  profileId: string
): void {
  switch (event.type) {
    case 'traffic':
      dependencies.publishTraffic(
        event.data as ProxyTrafficSummary,
        (event.data as ProxyTrafficSummary).profileId ?? profileId
      );
      break;
    case 'stats':
      dependencies.onStats?.(profileId, event.data as ProxyStatistics);
      break;
    case 'diagnostics': {
      const payload = event.data as { lines?: string[] };
      if (payload.lines?.length) {
        dependencies.onDiagnostics?.(profileId, payload.lines);
      }
      break;
    }
    case 'error': {
      const payload = event.data as { message?: string; kind?: string };
      dependencies.publishTraffic(
        {
          timestamp: event.timestamp,
          kind: 'error',
          url: '',
          host: '',
          endpoint: '',
          errorKind: payload.kind ?? 'PROXY_ERROR',
          errorMessage: payload.message ?? 'unknown error',
        },
        profileId
      );
      break;
    }
    default:
      break;
  }
}
