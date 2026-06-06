import type { HealthStatus } from '../../domain/entities/HealthStatus';
import type { IHealthChecker } from '../../domain/ports/IHealthChecker';
import type { IUpstreamPool } from '../../domain/ports/IUpstreamPool';

export type HealthStatusListener = (statuses: readonly HealthStatus[]) => void;

/**
 * Application service: wraps health checker with status notifications.
 */
export class UpstreamHealthMonitor {
  private readonly listeners: HealthStatusListener[] = [];

  constructor(private readonly healthChecker: IHealthChecker) {}

  onStatusChange(listener: HealthStatusListener): void {
    this.listeners.push(listener);
  }

  async start(pool: IUpstreamPool, intervalMs: number): Promise<void> {
    await this.healthChecker.startMonitoring(pool, intervalMs);
  }

  async stop(): Promise<void> {
    await this.healthChecker.stopMonitoring();
  }

  async checkNow(pool: IUpstreamPool): Promise<readonly HealthStatus[]> {
    const statuses = await this.healthChecker.checkOnce(pool);
    for (const listener of this.listeners) {
      listener(statuses);
    }
    return statuses;
  }

  isMonitoring(): boolean {
    return this.healthChecker.isMonitoring();
  }
}
