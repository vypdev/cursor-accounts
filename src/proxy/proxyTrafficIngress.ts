import type { ProxyStatistics } from '@cursor-accounts/types';
import type { ProxyTrafficSummary } from '../domain/types/proxyTraffic';
import type {
  IProxyTrafficIngress,
  TrafficIngressMode,
} from '../domain/ports/IProxyTrafficIngress';
import type { IProxyTrafficBus } from '../domain/ports/IProxyTrafficBus';
import type { IProxyApiClient } from '../domain/ports/IProxyApiClient';
import {
  ProxyLogTailer,
  type ProxyLogTailerHandlers,
  type ProxyLogTailerOptions,
} from './proxyLogTailer';
import {
  ProxyApiClient,
  type ProxyApiClientOptions,
} from './api/proxyApiClient';
import { ProxyApiTrafficIngress } from './proxyApiTrafficIngress';

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

export interface ProxyTrafficLogTailer {
  isRunning(): boolean;
  start(): Promise<void>;
  stop(): void;
}

export interface ProxyTrafficIngressFactories {
  createApiClient(options: ProxyApiClientOptions): IProxyApiClient;
  createLogTailer(
    logDir: string,
    handlers: ProxyLogTailerHandlers,
    options: ProxyLogTailerOptions
  ): ProxyTrafficLogTailer;
}

export class ProxyTrafficIngress implements IProxyTrafficIngress {
  private tailer: ProxyTrafficLogTailer | null = null;
  private activePort: number | null = null;
  private activeProfileId: string | null = null;
  private readonly apiIngress: ProxyApiTrafficIngress;

  constructor(
    private readonly logDir: string,
    private readonly trafficBus: IProxyTrafficBus,
    private readonly getTailFromStart: () => boolean,
    private readonly callbacks?: ProxyTrafficIngressCallbacks,
    private readonly factories: ProxyTrafficIngressFactories =
      createDefaultFactories()
  ) {
    this.apiIngress = new ProxyApiTrafficIngress({
      createApiClient: (options) => this.factories.createApiClient(options),
      publishTraffic: (summary, profileId) =>
        this.trafficBus.publish(summary, profileId),
      onStats: (profileId, stats) => this.callbacks?.onStats?.(profileId, stats),
      onDiagnostics: (profileId, lines) =>
        this.callbacks?.onDiagnostics?.(profileId, lines),
    });
  }

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
      await this.apiIngress.start(
        profileId,
        apiPort,
        options?.forceRestart === true,
        options?.apiToken
      );
    } else {
      this.apiIngress.stop(profileId);
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

    this.tailer = this.factories.createLogTailer(
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
    this.apiIngress.stop(profileId);
    this.stopJsonlTailer(profileId);
  }

  stopAll(): void {
    this.apiIngress.stopAll();
    this.stopJsonlTailer();
  }

  isRunning(profileId: string): boolean {
    const apiRunning = this.apiIngress.isRunning(profileId);
    const jsonlRunning =
      this.activeProfileId === profileId && (this.tailer?.isRunning() ?? false);
    return apiRunning || jsonlRunning;
  }

  getActivePort(): number | null {
    return this.activePort;
  }

  getApiClient(profileId: string): IProxyApiClient | undefined {
    return this.apiIngress.getClient(profileId);
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

function createDefaultFactories(): ProxyTrafficIngressFactories {
  return {
    createApiClient: (options) => new ProxyApiClient(options),
    createLogTailer: (logDir, handlers, options) =>
      new ProxyLogTailer(logDir, handlers, options),
  };
}
