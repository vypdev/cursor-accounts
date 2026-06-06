import type { MultiplexerStatusView } from '@cursor-accounts/types';
import type { MultiplexerMetricsView } from '../../application/types/multiplexerMetrics';
import type { MultiplexerConfig } from '../../application/types/multiplexerConfig';
import type { RoutingStrategyName } from '../types/multiplexerTypes';
import type { SessionBinding } from './ISessionStore';

export interface MultiplexerStartResult {
  success: boolean;
  port?: number;
  error?: string;
}

export interface MultiplexerStatus {
  running: boolean;
  port?: number;
  strategy?: RoutingStrategyName;
  upstreamCount: number;
  activeSessions: number;
}

/** Port: extension-facing multiplexor lifecycle facade. */
export interface IMultiplexerManager {
  start(config?: Partial<MultiplexerConfig>): Promise<MultiplexerStartResult>;
  stop(): Promise<void>;
  restart(): Promise<MultiplexerStartResult>;
  getStatus(): Promise<MultiplexerStatus>;
  isRunning(): boolean;
  getMetrics(): Promise<MultiplexerMetricsView | null>;
  getSessions(): readonly SessionBinding[];
  getConfig(): Promise<MultiplexerConfig>;
  setStrategy(strategy: RoutingStrategyName): Promise<MultiplexerStartResult>;
  getProxyServerUrl(): string | null;
  buildStatusView(): Promise<MultiplexerStatusView>;
  onStatusChange(callback: () => void): void;
}
