import type { MultiplexerMetricsSnapshot } from '../../../domain/ports/IMultiplexerMetrics';

export type WsNotificationType =
  | 'upstream_created'
  | 'upstream_stopped'
  | 'metrics_updated'
  | 'status_changed'
  | 'config_changed';

export interface WsNotification<T = unknown> {
  type: WsNotificationType;
  timestamp: string;
  data: T;
}

export interface UpstreamCreatedData {
  upstreamId: string;
  profileId: string;
  workspacePath: string;
}

export interface UpstreamStoppedData {
  upstreamId: string;
  reason?: string;
}

export interface MetricsUpdatedData {
  metrics: MultiplexerMetricsSnapshot;
}

export interface StatusChangedData {
  running: boolean;
  upstreamCount: number;
}

export interface ConfigChangedData {
  strategy: string;
}
