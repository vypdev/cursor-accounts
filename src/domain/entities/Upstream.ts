import type { UpstreamHealthState } from '../types/multiplexerTypes';

/**
 * Entity: MITM proxy upstream with connection and health state.
 */
export class Upstream {
  private activeConnections = 0;
  private _health: UpstreamHealthState = 'healthy';
  private lastHealthCheck?: Date;

  constructor(
    public readonly id: string,
    public readonly host: string,
    public readonly port: number,
    public readonly weight: number = 1,
    public readonly maxConnections: number = 100
  ) {
    if (!id || id.trim().length === 0) {
      throw new Error('Upstream id is required');
    }
    if (port < 1 || port > 65535) {
      throw new Error(`Invalid port: ${port}`);
    }
    if (weight <= 0) {
      throw new Error(`Weight must be positive: ${weight}`);
    }
    if (maxConnections <= 0) {
      throw new Error(`maxConnections must be positive: ${maxConnections}`);
    }
  }

  /** Whether this upstream can accept another connection. */
  canAcceptConnection(): boolean {
    return this._health === 'healthy' && this.activeConnections < this.maxConnections;
  }

  setHealth(healthy: boolean, timestamp: Date = new Date()): void {
    this._health = healthy ? 'healthy' : 'unhealthy';
    this.lastHealthCheck = timestamp;
  }

  get healthy(): boolean {
    return this._health === 'healthy';
  }

  get healthState(): UpstreamHealthState {
    return this._health;
  }

  get lastCheckedAt(): Date | undefined {
    return this.lastHealthCheck;
  }

  incrementConnections(): void {
    this.activeConnections++;
  }

  decrementConnections(): void {
    if (this.activeConnections > 0) {
      this.activeConnections--;
    }
  }

  get connectionCount(): number {
    return this.activeConnections;
  }

  get currentLoad(): number {
    return this.activeConnections / this.maxConnections;
  }

  get url(): string {
    return `http://${this.host}:${this.port}`;
  }
}
