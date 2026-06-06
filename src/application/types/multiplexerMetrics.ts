import type { MultiplexerMetricsSnapshot } from '../../domain/ports/IMultiplexerMetrics';

/** Aggregated metrics exposed to UI and CLI. */
export interface MultiplexerMetricsView {
  snapshot: MultiplexerMetricsSnapshot;
  generatedAt: string;
  routerPort?: number;
  strategy?: string;
}
