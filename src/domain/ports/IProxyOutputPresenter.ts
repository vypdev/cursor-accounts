import type { ProxyTrafficSummary } from '../types/proxyTraffic';

export interface ProxyOutputSettings {
  logTrafficToOutput: boolean;
  autoShowOutputChannel: boolean;
  outputCursorHostsOnly: boolean;
}

/** Output boundary used by proxy orchestration without depending on VS Code UI classes. */
export interface IProxyOutputPresenter {
  appendStarted(port: number): void;
  appendAttached(port: number): void;
  appendTailing(logFilePath: string): void;
  appendLogDisabled(): void;
  appendStopped(): void;
  appendDiagnostics(lines: string[]): void;
  appendTraffic(summary: ProxyTrafficSummary): void;
  appendError(summary: ProxyTrafficSummary): void;
  show(): void;
}

export interface ITokenDetectorOutputPresenter {
  appendInitialized(profileId: string): void;
  appendTraffic(summary: ProxyTrafficSummary, profileId?: string): void;
  show(): void;
}
