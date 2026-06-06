/**
 * Entity: Client session identified by source IP and ephemeral port.
 */
export class Session {
  constructor(
    public readonly sourceIp: string,
    public readonly sourcePort: number
  ) {
    if (!sourceIp || sourceIp.trim().length === 0) {
      throw new Error('Session sourceIp is required');
    }
    if (sourcePort < 0 || sourcePort > 65535) {
      throw new Error(`Invalid source port: ${sourcePort}`);
    }
  }

  /** Stable key for sticky session routing. */
  get key(): string {
    return `${this.sourceIp}:${this.sourcePort}`;
  }

  static fromKey(key: string): Session {
    const separator = key.lastIndexOf(':');
    if (separator <= 0) {
      throw new Error(`Invalid session key: ${key}`);
    }
    const sourceIp = key.slice(0, separator);
    const sourcePort = Number.parseInt(key.slice(separator + 1), 10);
    return new Session(sourceIp, sourcePort);
  }
}
