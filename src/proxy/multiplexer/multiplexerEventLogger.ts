import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RoutingEvent } from '../../application/types/routingEvent';
import { MULTIPLEXER_LOG_PREFIX, getMultiplexerLogDir } from './multiplexerPaths';

const MAX_LOG_FILES = 3;
const LOG_FILE_EXT = '.jsonl';

export type MultiplexerLogLevel = 'info' | 'warn' | 'error';

export interface MultiplexerLogEntry {
  timestamp: string;
  level: MultiplexerLogLevel;
  component: 'multiplexer';
  event: string;
  [key: string]: unknown;
}

/** Writes multiplexor lifecycle and routing events to rotating JSONL logs. */
export class MultiplexerEventLogger {
  private currentLogPath: string | null = null;

  constructor(private readonly logDir = getMultiplexerLogDir()) {}

  async logMultiplexerStarted(port: number, strategy?: string): Promise<void> {
    await this.append({
      level: 'info',
      event: 'multiplexer_started',
      port,
      ...(strategy ? { strategy } : {}),
    });
  }

  async logMultiplexerStopped(): Promise<void> {
    await this.append({
      level: 'info',
      event: 'multiplexer_stopped',
    });
  }

  async logUpstreamCreated(
    upstreamId: string,
    profileId: string,
    workspace: string,
    port: number
  ): Promise<void> {
    await this.append({
      level: 'info',
      event: 'upstream_created',
      upstreamId,
      profileId,
      workspace,
      port,
    });
  }

  async logUpstreamStopped(upstreamId: string, reason?: string): Promise<void> {
    await this.append({
      level: 'info',
      event: 'upstream_stopped',
      upstreamId,
      ...(reason ? { reason } : {}),
    });
  }

  async logTokenExtraction(
    email: string | null,
    profileId: string | null
  ): Promise<void> {
    await this.append({
      level: 'info',
      event: 'token_extraction',
      email,
      profileId,
    });
  }

  async logRoutingDecision(
    profileId: string | null,
    workspace: string | null,
    upstreamId: string,
    reason: string
  ): Promise<void> {
    await this.append({
      level: 'info',
      event: 'routing_decision',
      profileId,
      workspace,
      upstreamId,
      reason,
    });
  }

  async logSettingsModified(userDataDir: string, proxyUrl: string): Promise<void> {
    await this.append({
      level: 'info',
      event: 'settings_modified',
      userDataDir,
      proxyUrl,
    });
  }

  async logSettingsRestored(userDataDir: string): Promise<void> {
    await this.append({
      level: 'info',
      event: 'settings_restored',
      userDataDir,
    });
  }

  async logError(message: string, error?: string): Promise<void> {
    await this.append({
      level: 'error',
      event: 'error',
      message,
      ...(error ? { error } : {}),
    });
  }

  async logApiRequest(
    endpoint: string,
    method: string,
    statusCode: number
  ): Promise<void> {
    await this.append({
      level: 'info',
      event: 'api_request',
      endpoint,
      method,
      statusCode,
    });
  }

  async logApiError(endpoint: string, error: string): Promise<void> {
    await this.append({
      level: 'error',
      event: 'api_error',
      endpoint,
      error,
    });
  }

  async logApiWebSocketConnected(clientCount: number): Promise<void> {
    await this.append({
      level: 'info',
      event: 'api_websocket_connected',
      clientCount,
    });
  }

  async logApiWebSocketDisconnected(clientCount: number): Promise<void> {
    await this.append({
      level: 'info',
      event: 'api_websocket_disconnected',
      clientCount,
    });
  }

  async appendRouting(event: RoutingEvent): Promise<void> {
    await this.append({
      level: 'info',
      event: 'routing_decision',
      sessionKey: event.sessionKey,
      upstreamId: event.upstreamId,
      upstreamHost: event.upstreamHost,
      upstreamPort: event.upstreamPort,
      strategy: event.strategy,
      reason: event.reason,
      targetHost: event.targetHost,
      workspacePath: event.workspacePath,
    });
  }

  private async append(
    fields: Omit<MultiplexerLogEntry, 'timestamp' | 'component'>
  ): Promise<void> {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
      await this.rotateLogsIfNeeded();
      const logPath = this.resolveLogPath();
      const line = `${JSON.stringify({
        timestamp: new Date().toISOString(),
        component: 'multiplexer' as const,
        ...fields,
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
      `${MULTIPLEXER_LOG_PREFIX}-${date}-${Date.now()}${LOG_FILE_EXT}`
    );
    return this.currentLogPath;
  }

  private async rotateLogsIfNeeded(): Promise<void> {
    const logFiles = await listMultiplexerLogFiles(this.logDir);
    if (logFiles.length < MAX_LOG_FILES) {
      return;
    }

    const toDelete = logFiles.slice(0, logFiles.length - MAX_LOG_FILES + 1);
    for (const filePath of toDelete) {
      if (filePath === this.currentLogPath) {
        continue;
      }
      await fs.unlink(filePath).catch(() => {});
    }
  }
}

/** Lists multiplexor JSONL files in logDir sorted by mtime (oldest first). */
export async function listMultiplexerLogFiles(logDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(logDir);
  } catch {
    return [];
  }

  const paths = entries
    .filter(
      (name) => name.startsWith(`${MULTIPLEXER_LOG_PREFIX}-`) && name.endsWith(LOG_FILE_EXT)
    )
    .map((name) => path.join(logDir, name));

  const withStats = await Promise.all(
    paths.map(async (filePath) => ({
      filePath,
      mtime: (await fs.stat(filePath)).mtimeMs,
    }))
  );
  withStats.sort((a, b) => a.mtime - b.mtime);
  return withStats.map((entry) => entry.filePath);
}
