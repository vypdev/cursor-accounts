import type { HealthStatus } from '../entities/HealthStatus';
import type { IUpstreamPool } from './IUpstreamPool';

/**
 * Port: monitors upstream health and updates pool state.
 */
export interface IHealthChecker {
  startMonitoring(pool: IUpstreamPool, intervalMs: number): Promise<void>;
  stopMonitoring(): Promise<void>;
  checkOnce(pool: IUpstreamPool): Promise<readonly HealthStatus[]>;
  isMonitoring(): boolean;
}
