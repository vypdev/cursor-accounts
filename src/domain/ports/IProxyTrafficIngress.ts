export interface TrafficIngressMode {
  readonly ipc: boolean;
  readonly jsonlTail: boolean;
}

export interface IProxyTrafficIngress {
  start(
    profileId: string,
    port: number,
    mode: TrafficIngressMode,
    options?: { attached?: boolean; tailFromStart?: boolean; forceRestart?: boolean }
  ): Promise<void>;
  stop(profileId: string): void;
  stopAll(): void;
  isRunning(profileId: string): boolean;
  getActivePort(): number | null;
}
