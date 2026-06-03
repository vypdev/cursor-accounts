import * as fs from 'fs/promises';
import { watch, type FSWatcher } from 'fs';
import * as path from 'path';
import { toTrafficSummary } from './proxyTrafficFormat';
import { buildTrafficSummary } from './trafficSummaryBuilder';
import type { ProxyLogEntry, ProxyTrafficSummary } from './types';

const LOG_FILE_PREFIX = 'proxy-';
const LOG_FILE_EXT = '.jsonl';
const POLL_INTERVAL_MS = 500;

export interface ProxyLogTailerHandlers {
  onTraffic: (summary: ProxyTrafficSummary) => void;
  onError?: (summary: ProxyTrafficSummary) => void;
  onLogFileResolved?: (filePath: string | null) => void;
}

export interface ProxyLogTailerOptions {
  pollIntervalMs?: number;
  /** When true, replay the last portion of the active log on start. */
  tailFromStart?: boolean;
  /** Max bytes to read when tailFromStart is enabled. */
  tailFromStartMaxBytes?: number;
}

/**
 * Tails the shared proxy JSONL log and emits traffic summaries for the Output channel.
 * Works across extension host windows (unlike child IPC).
 */
export class ProxyLogTailer {
  private running = false;
  private currentFilePath: string | null = null;
  private fileOffset = 0;
  private partialLine = '';
  private dirWatcher: FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readChain: Promise<void> = Promise.resolve();
  private readonly requestStartedAt = new Map<string, number>();

  constructor(
    private readonly logDir: string,
    private readonly handlers: ProxyLogTailerHandlers,
    private readonly options: ProxyLogTailerOptions = {}
  ) {}

  getActiveLogPath(): string | null {
    return this.currentFilePath;
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    await this.resolveActiveLogFile(true);
    this.startWatching();
    this.scheduleRead();
  }

  stop(): void {
    this.running = false;
    if (this.dirWatcher) {
      this.dirWatcher.close();
      this.dirWatcher = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.currentFilePath = null;
    this.fileOffset = 0;
    this.partialLine = '';
    this.requestStartedAt.clear();
  }

  private startWatching(): void {
    const interval = this.options.pollIntervalMs ?? POLL_INTERVAL_MS;

    try {
      this.dirWatcher = watch(this.logDir, () => {
        void this.scheduleRead();
      });
    } catch {
      // logDir may not exist yet; polling will retry
    }

    this.pollTimer = setInterval(() => {
      void this.scheduleRead();
    }, interval);
  }

  private scheduleRead(): void {
    this.readChain = this.readChain.then(async () => {
      if (!this.running) {
        return;
      }
      await this.resolveActiveLogFile(false);
      await this.readNewLines();
    });
  }

  private async resolveActiveLogFile(isInitial: boolean): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.logDir);
    } catch {
      this.handlers.onLogFileResolved?.(null);
      return;
    }

    const logFiles = entries.filter(
      (name) => name.startsWith(LOG_FILE_PREFIX) && name.endsWith(LOG_FILE_EXT)
    );
    if (logFiles.length === 0) {
      this.handlers.onLogFileResolved?.(null);
      return;
    }

    const withStats = await Promise.all(
      logFiles.map(async (name) => {
        const filePath = path.join(this.logDir, name);
        const stat = await fs.stat(filePath);
        return { filePath, mtime: stat.mtimeMs, size: stat.size };
      })
    );
    withStats.sort((a, b) => a.mtime - b.mtime);
    const latest = withStats[withStats.length - 1]!;

    if (this.currentFilePath === latest.filePath) {
      return;
    }

    this.currentFilePath = latest.filePath;
    this.partialLine = '';
    this.requestStartedAt.clear();

    if (isInitial && this.options.tailFromStart) {
      const maxBytes = this.options.tailFromStartMaxBytes ?? 64 * 1024;
      this.fileOffset = Math.max(0, latest.size - maxBytes);
    } else {
      this.fileOffset = latest.size;
    }

    this.handlers.onLogFileResolved?.(latest.filePath);
  }

  private async readNewLines(): Promise<void> {
    if (!this.currentFilePath) {
      return;
    }

    let stat;
    try {
      stat = await fs.stat(this.currentFilePath);
    } catch {
      this.currentFilePath = null;
      this.fileOffset = 0;
      return;
    }

    if (stat.size < this.fileOffset) {
      this.fileOffset = 0;
      this.partialLine = '';
    }

    if (stat.size === this.fileOffset) {
      return;
    }

    const handle = await fs.open(this.currentFilePath, 'r');
    try {
      const length = stat.size - this.fileOffset;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, this.fileOffset);
      this.fileOffset += bytesRead;

      const chunk = buffer.subarray(0, bytesRead).toString('utf8');
      this.processChunk(chunk);
    } finally {
      await handle.close();
    }
  }

  private processChunk(chunk: string): void {
    const combined = this.partialLine + chunk;
    const lines = combined.split('\n');
    this.partialLine = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      this.processLine(trimmed);
    }
  }

  private processLine(line: string): void {
    let entry: ProxyLogEntry;
    try {
      entry = JSON.parse(line) as ProxyLogEntry;
    } catch {
      return;
    }

    if (entry.direction === 'error') {
      this.handlers.onError?.(toTrafficSummary(entry));
      return;
    }

    const requestId = entry.requestId;
    let durationMs: number | undefined;
    if (entry.direction === 'request' && requestId) {
      this.requestStartedAt.set(requestId, Date.parse(entry.timestamp));
    } else if (entry.direction === 'response' && requestId) {
      const startedAt = this.requestStartedAt.get(requestId);
      if (startedAt != null && !Number.isNaN(startedAt)) {
        durationMs = Math.max(0, Date.parse(entry.timestamp) - startedAt);
      }
      this.requestStartedAt.delete(requestId);
    }

    if (entry.direction === 'request' || entry.direction === 'response') {
      void buildTrafficSummary(entry, durationMs, { logDir: this.logDir }).then((summary) => {
        this.handlers.onTraffic(summary);
      }).catch(() => {
        this.handlers.onTraffic(toTrafficSummary(entry, durationMs));
      });
    }
  }
}

/** Lists proxy JSONL files in logDir sorted by mtime (oldest first). */
export async function listProxyLogFiles(logDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(logDir);
  } catch {
    return [];
  }

  const paths = entries
    .filter((name) => name.startsWith(LOG_FILE_PREFIX) && name.endsWith(LOG_FILE_EXT))
    .map((name) => path.join(logDir, name));

  const withStats = await Promise.all(
    paths.map(async (filePath) => ({
      filePath,
      mtime: (await fs.stat(filePath)).mtimeMs,
    }))
  );
  withStats.sort((a, b) => a.mtime - b.mtime);
  return withStats.map((x) => x.filePath);
}
