import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RoutingEvent } from '../../application/types/routingEvent';
import { getMultiplexerLogDir } from './multiplexerPaths';

/** Appends routing decisions to JSONL logs. */
export class RoutingEventLogger {
  private currentLogPath: string | null = null;

  constructor(private readonly logDir = getMultiplexerLogDir()) {}

  async append(event: RoutingEvent): Promise<void> {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
      const logPath = this.resolveLogPath();
      const line = `${JSON.stringify({
        timestamp: event.timestamp,
        level: 'info',
        component: 'multiplexer',
        event: 'routing_decision',
        sessionKey: event.sessionKey,
        selectedUpstream: event.upstreamId,
        upstreamHost: event.upstreamHost,
        upstreamPort: event.upstreamPort,
        strategy: event.strategy,
        reason: event.reason,
        targetHost: event.targetHost,
        workspacePath: event.workspacePath,
      })}\n`;
      await fs.appendFile(logPath, line, 'utf8');
    } catch {
      // Best-effort observability; routing must not fail when logs are unavailable.
    }
  }

  private resolveLogPath(): string {
    if (this.currentLogPath) {
      return this.currentLogPath;
    }
    const date = new Date().toISOString().slice(0, 10);
    this.currentLogPath = path.join(
      this.logDir,
      `router-${date}-${Date.now()}.jsonl`
    );
    return this.currentLogPath;
  }
}
