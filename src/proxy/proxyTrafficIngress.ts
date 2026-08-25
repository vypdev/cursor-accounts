import type { ProxyStatistics } from '@cursor-accounts/types';
import type { ProxyTrafficSummary } from '../domain/types/proxyTraffic';
import type {
  IProxyTrafficIngress,
  TrafficIngressMode,
} from '../domain/ports/IProxyTrafficIngress';
import type { IProxyTrafficBus } from '../domain/ports/IProxyTrafficBus';
import type { IProxyApiClient } from '../domain/ports/IProxyApiClient';
import type { ProxyApiEvent } from '../application/types/proxyApi';
import { ProxyLogTailer } from './proxyLogTailer';
import {
  ProxyApiClient,
  buildProxyApiBaseUrl,
} from './api/proxyApiClient';

export interface ProxyTrafficIngressCallbacks {
  onLogFileResolved?: (filePath: string | null) => void;
  onTailerError?: (profileId: string, summary: ProxyTrafficSummary) => void;
  onStats?: (profileId: string, stats: ProxyStatistics) => void;
  onDiagnostics?: (profileId: string, lines: string[]) => void;
}

export interface ProxyTrafficIngressStartOptions {
  attached?: boolean;
  tailFromStart?: boolean;
  forceRestart?: boolean;
  /** Required when mode.api is true. */
  apiPort?: number;
  apiToken?: string;
}

export class ProxyTrafficIngress implements IProxyTrafficIngress {
  private tailer: ProxyLogTailer | null = null;
  private activePort: number | null = null;
  private activeProfileId: string | null = null;
  private readonly apiClients = new Map<string, IProxyApiClient>();
  private readonly apiUnsubscribers = new Map<string, () => void>();

  constructor(
    private readonly logDir: string,
    private readonly trafficBus: IProxyTrafficBus,
    private readonly getTailFromStart: () => boolean,
    private readonly callbacks?: ProxyTrafficIngressCallbacks
  ) {}

  async start(
    profileId: string,
    port: number,
    mode: TrafficIngressMode,
    options?: ProxyTrafficIngressStartOptions
  ): Promise<void> {
    if (mode.api) {
      const apiPort = options?.apiPort;
      if (apiPort == null) {
        throw new Error(
          `[ProxyTrafficIngress] apiPort is required when mode.api is enabled`
        );
      }
      await this.ensureApiClient(
        profileId,
        apiPort,
        options?.forceRestart === true,
        options?.apiToken
      );
    } else {
      this.stopApiClient(profileId);
    }

    if (!mode.jsonlTail) {
      this.stopJsonlTailer(profileId);
      return;
    }

    const forceRestart = options?.forceRestart === true;
    if (
      this.tailer?.isRunning() &&
      this.activePort === port &&
      this.activeProfileId === profileId &&
      !forceRestart
    ) {
      return;
    }

    this.stopJsonlTailer();

    const tailFromStart = options?.tailFromStart ?? this.getTailFromStart();

    this.tailer = new ProxyLogTailer(
      this.logDir,
      {
        onTraffic: (summary) => {
          this.trafficBus.publish(summary, profileId);
        },
        onError: (summary) => {
          this.callbacks?.onTailerError?.(profileId, summary);
          this.trafficBus.publish(summary, profileId);
        },
        onLogFileResolved: (filePath) => {
          this.callbacks?.onLogFileResolved?.(filePath);
        },
      },
      { tailFromStart }
    );

    this.activePort = port;
    this.activeProfileId = profileId;
    await this.tailer.start();
  }

  stop(profileId: string): void {
    this.stopApiClient(profileId);
    this.stopJsonlTailer(profileId);
  }

  stopAll(): void {
    for (const profileId of [...this.apiClients.keys()]) {
      this.stopApiClient(profileId);
    }
    this.stopJsonlTailer();
  }

  isRunning(profileId: string): boolean {
    const apiRunning = this.apiClients.get(profileId)?.isConnected() === true;
    const jsonlRunning =
      this.activeProfileId === profileId && (this.tailer?.isRunning() ?? false);
    return apiRunning || jsonlRunning;
  }

  getActivePort(): number | null {
    return this.activePort;
  }

  getApiClient(profileId: string): IProxyApiClient | undefined {
    return this.apiClients.get(profileId);
  }

  private async ensureApiClient(
    profileId: string,
    apiPort: number,
    forceRestart: boolean,
    apiToken?: string
  ): Promise<void> {
    const existing = this.apiClients.get(profileId);
    if (existing?.isConnected() && !forceRestart) {
      return;
    }

    this.stopApiClient(profileId);

    const client = new ProxyApiClient({
      baseUrl: buildProxyApiBaseUrl(apiPort),
      reconnect: true,
      apiToken,
    });

    const unsubscribe = client.onEvent((event) => {
      this.handleApiEvent(event, profileId);
    });

    await client.connect();
    this.apiClients.set(profileId, client);
    this.apiUnsubscribers.set(profileId, unsubscribe);
  }

  private handleApiEvent(event: ProxyApiEvent, profileId: string): void {
    switch (event.type) {
      case 'traffic':
        this.trafficBus.publish(
          event.data as ProxyTrafficSummary,
          (event.data as ProxyTrafficSummary).profileId ?? profileId
        );
        break;
      case 'stats':
        this.callbacks?.onStats?.(
          profileId,
          event.data as ProxyStatistics
        );
        break;
      case 'diagnostics': {
        const payload = event.data as { lines?: string[] };
        if (payload.lines?.length) {
          this.callbacks?.onDiagnostics?.(profileId, payload.lines);
        }
        break;
      }
      case 'error': {
        const payload = event.data as { message?: string; kind?: string };
        this.trafficBus.publish(
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

  private stopApiClient(profileId: string): void {
    this.apiUnsubscribers.get(profileId)?.();
    this.apiUnsubscribers.delete(profileId);
    this.apiClients.get(profileId)?.disconnect();
    this.apiClients.delete(profileId);
  }

  private stopJsonlTailer(profileId?: string): void {
    if (profileId != null && this.activeProfileId !== profileId) {
      return;
    }
    if (this.tailer) {
      this.tailer.stop();
      this.tailer = null;
    }
    this.activePort = null;
    this.activeProfileId = null;
  }
}
