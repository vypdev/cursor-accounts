import type { ProxyServerConfig } from '../../application/types/proxyConfig';

export interface ProxyProcessRuntime {
  port: number;
  apiPort: number;
  pid: number | undefined;
  startedAt: Date;
}

export interface IProxyProcess {
  start(config: ProxyServerConfig): Promise<ProxyProcessRuntime>;
  stop(pid: number | undefined, signal?: NodeJS.Signals): Promise<void>;
  isAlive(pid: number): boolean;
  onExit(handler: (code: number | null) => void): void;
  onStderr(handler: (chunk: string) => void): void;
}
