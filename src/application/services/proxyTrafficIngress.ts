import type { ProxyTrafficSummary } from '../types/proxyTraffic';
import type {
  IProxyTrafficIngress,
  TrafficIngressMode,
} from '../../domain/ports/IProxyTrafficIngress';
import type { IProxyTrafficBus } from '../../domain/ports/IProxyTrafficBus';
import { ProxyLogTailer } from '../../proxy/proxyLogTailer';

export interface ProxyTrafficIngressCallbacks {
  onLogFileResolved?: (filePath: string | null) => void;
  onTailerError?: (profileId: string, summary: ProxyTrafficSummary) => void;
}

export class ProxyTrafficIngress implements IProxyTrafficIngress {
  private tailer: ProxyLogTailer | null = null;
  private activePort: number | null = null;
  private activeProfileId: string | null = null;

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
    options?: {
      attached?: boolean;
      tailFromStart?: boolean;
      forceRestart?: boolean;
    }
  ): Promise<void> {
    if (!mode.jsonlTail) {
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

    this.stopAll();

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
    if (this.activeProfileId === profileId) {
      this.stopAll();
    }
  }

  stopAll(): void {
    if (this.tailer) {
      this.tailer.stop();
      this.tailer = null;
    }
    this.activePort = null;
    this.activeProfileId = null;
  }

  isRunning(profileId: string): boolean {
    return (
      this.activeProfileId === profileId && (this.tailer?.isRunning() ?? false)
    );
  }

  getActivePort(): number | null {
    return this.activePort;
  }
}
