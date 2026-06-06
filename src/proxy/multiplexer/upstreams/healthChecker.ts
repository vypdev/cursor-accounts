import * as net from 'node:net';
import { HealthStatus } from '../../../domain/entities/HealthStatus';
import type { IHealthChecker } from '../../../domain/ports/IHealthChecker';
import type { IUpstreamPool } from '../../../domain/ports/IUpstreamPool';

interface HealthCheckerOptions {
  timeoutMs?: number;
  unhealthyThreshold?: number;
}

/** TCP connect-based upstream health checker. */
export class HealthChecker implements IHealthChecker {
  private interval: ReturnType<typeof setInterval> | undefined;
  private pool: IUpstreamPool | null = null;
  private readonly failureCounts = new Map<string, number>();
  private readonly timeoutMs: number;
  private readonly unhealthyThreshold: number;

  constructor(options: HealthCheckerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.unhealthyThreshold = options.unhealthyThreshold ?? 3;
  }

  async startMonitoring(pool: IUpstreamPool, intervalMs: number): Promise<void> {
    this.pool = pool;
    await this.checkOnce(pool);
    this.interval = setInterval(() => {
      if (this.pool) {
        void this.checkOnce(this.pool);
      }
    }, intervalMs);
  }

  async stopMonitoring(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    this.pool = null;
  }

  isMonitoring(): boolean {
    return this.interval != null;
  }

  async checkOnce(pool: IUpstreamPool): Promise<readonly HealthStatus[]> {
    const statuses: HealthStatus[] = [];

    for (const upstream of pool.getAll()) {
      const started = Date.now();
      const healthy = await this.probe(upstream.host, upstream.port);
      const latencyMs = Date.now() - started;

      if (healthy) {
        this.failureCounts.delete(upstream.id);
        upstream.setHealth(true);
        statuses.push(
          new HealthStatus(upstream.id, 'healthy', new Date(), latencyMs)
        );
      } else {
        const failures = (this.failureCounts.get(upstream.id) ?? 0) + 1;
        this.failureCounts.set(upstream.id, failures);
        if (failures >= this.unhealthyThreshold) {
          upstream.setHealth(false);
        }
        statuses.push(
          new HealthStatus(
            upstream.id,
            failures >= this.unhealthyThreshold ? 'unhealthy' : 'unknown',
            new Date(),
            latencyMs,
            'TCP connect failed'
          )
        );
      }
    }

    return statuses;
  }

  private probe(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, this.timeoutMs);

      socket.once('connect', () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      });

      socket.once('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }
}
