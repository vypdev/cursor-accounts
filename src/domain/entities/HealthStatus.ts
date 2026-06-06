import type { UpstreamHealthState } from '../types/multiplexerTypes';

/** Value object: health check result for an upstream. */
export class HealthStatus {
  constructor(
    public readonly upstreamId: string,
    public readonly state: UpstreamHealthState,
    public readonly checkedAt: Date,
    public readonly latencyMs?: number,
    public readonly errorMessage?: string
  ) {}

  get isHealthy(): boolean {
    return this.state === 'healthy';
  }
}
