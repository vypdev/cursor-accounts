export interface TrafficIngressMode {
  /** Connect to the proxy localhost WebSocket API for live traffic. */
  readonly api: boolean;
  /** Tail shared JSONL logs (development / offline analysis). */
  readonly jsonlTail: boolean;
}

export interface IProxyTrafficIngress {
  start(
    profileId: string,
    port: number,
    mode: TrafficIngressMode,
    options?: {
      attached?: boolean;
      tailFromStart?: boolean;
      forceRestart?: boolean;
      apiPort?: number;
    }
  ): Promise<void>;
  stop(profileId: string): void;
  stopAll(): void;
  isRunning(profileId: string): boolean;
  getActivePort(): number | null;
}
