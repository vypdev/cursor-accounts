import type { ProxyChildMessage, ProxyParentMessage } from '../../application/types/proxyTraffic';
import type { ProxyServerConfig } from '../../application/types/proxyConfig';

export interface ProxyProcessRuntime {
  port: number;
  pid: number | undefined;
  startedAt: Date;
}

export interface IProxyProcess {
  start(config: ProxyServerConfig): Promise<ProxyProcessRuntime>;
  stop(pid: number | undefined, signal?: NodeJS.Signals): Promise<void>;
  isAlive(pid: number): boolean;
  isConnected(): boolean;
  onMessage(handler: (msg: ProxyChildMessage) => void): void;
  onExit(handler: (code: number | null) => void): void;
  onStderr(handler: (chunk: string) => void): void;
  send(message: ProxyParentMessage): void;
  sendShutdown(timeoutMs: number): Promise<void>;
  waitForReady(port: number, timeoutMs: number): Promise<{ success: boolean; port?: number; error?: string }>;
}
