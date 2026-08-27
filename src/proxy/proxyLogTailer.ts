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
 * Works across extension host windows (optional fallback when API attach is unavailable).
 */
export class ProxyLogTailer {
  private running = false;
  private lifecycleGeneration = 0;
  private startPromise: Promise<void> | null = null;
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
    const pendingStart = this.startPromise;
    if (pendingStart) {
      await pendingStart;
      if (this.running) {
        return;
      }
    } else if (this.running) {
      return;
    }

    const generation = ++this.lifecycleGeneration;
    this.running = true;
    const startPromise = this.startInternal(generation);
    this.startPromise = startPromise;

    try {
      await startPromise;
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = null;
      }
    }
  }

  stop(): void {
    this.lifecycleGeneration += 1;
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

  private async startInternal(generation: number): Promise<void> {
    try {
      await this.resolveActiveLogFile(true, generation);
      if (!this.isActive(generation)) {
        return;
      }
      this.startWatching(generation);
      void this.scheduleRead(generation);
    } catch (error) {
      if (generation === this.lifecycleGeneration) {
        this.stop();
      }
      throw error;
    }
  }

  private startWatching(generation: number): void {
    const interval = this.options.pollIntervalMs ?? POLL_INTERVAL_MS;

    try {
      const watcher = watch(this.logDir, () => {
        void this.scheduleRead(generation);
      });
      watcher.on('error', () => {
        if (this.isActive(generation)) {
          void this.scheduleRead(generation);
        }
      });
      this.dirWatcher = watcher;
    } catch {
      // logDir may not exist yet; polling will retry
    }

    this.pollTimer = setInterval(() => {
      void this.scheduleRead(generation);
    }, interval);
  }

  private scheduleRead(generation = this.lifecycleGeneration): Promise<void> {
    this.readChain = this.readChain
      .catch(() => undefined)
      .then(async () => {
        if (!this.isActive(generation)) {
          return;
        }
        await this.resolveActiveLogFile(false, generation);
        if (!this.isActive(generation)) {
          return;
        }
        await this.readNewLines(generation);
      })
      .catch(() => undefined);
    return this.readChain;
  }

  private async resolveActiveLogFile(
    isInitial: boolean,
    generation: number
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.logDir);
    } catch {
      if (this.isActive(generation)) {
        this.handlers.onLogFileResolved?.(null);
      }
      return;
    }

    if (!this.isActive(generation)) {
      return;
    }

    const logFiles = entries.filter(
      (name) => name.startsWith(LOG_FILE_PREFIX) && name.endsWith(LOG_FILE_EXT)
    );
    if (logFiles.length === 0) {
      this.currentFilePath = null;
      this.fileOffset = 0;
      this.partialLine = '';
      this.requestStartedAt.clear();
      this.handlers.onLogFileResolved?.(null);
      return;
    }

    const withStats = (
      await Promise.all(
        logFiles.map(async (name) => {
          const filePath = path.join(this.logDir, name);
          try {
            const stat = await fs.stat(filePath);
            return { filePath, mtime: stat.mtimeMs, size: stat.size };
          } catch {
            return null;
          }
        })
      )
    ).filter((value): value is NonNullable<typeof value> => value !== null);

    if (!this.isActive(generation)) {
      return;
    }
    if (withStats.length === 0) {
      this.currentFilePath = null;
      this.fileOffset = 0;
      this.partialLine = '';
      this.requestStartedAt.clear();
      this.handlers.onLogFileResolved?.(null);
      return;
    }

    withStats.sort((a, b) => a.mtime - b.mtime || comparePaths(a.filePath, b.filePath));
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

  private async readNewLines(generation: number): Promise<void> {
    const filePath = this.currentFilePath;
    if (!this.isActive(generation) || !filePath) {
      return;
    }

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      if (this.isActive(generation) && this.currentFilePath === filePath) {
        this.currentFilePath = null;
        this.fileOffset = 0;
        this.partialLine = '';
        this.requestStartedAt.clear();
        this.handlers.onLogFileResolved?.(null);
      }
      return;
    }

    if (!this.isActive(generation) || this.currentFilePath !== filePath) {
      return;
    }

    if (stat.size < this.fileOffset) {
      this.fileOffset = 0;
      this.partialLine = '';
    }

    if (stat.size === this.fileOffset) {
      return;
    }

    const handle = await fs.open(filePath, 'r');
    try {
      if (!this.isActive(generation) || this.currentFilePath !== filePath) {
        return;
      }
      const length = stat.size - this.fileOffset;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, this.fileOffset);
      if (!this.isActive(generation) || this.currentFilePath !== filePath) {
        return;
      }
      this.fileOffset += bytesRead;

      const chunk = buffer.subarray(0, bytesRead).toString('utf8');
      this.processChunk(chunk, generation);
    } finally {
      await handle.close();
    }
  }

  private processChunk(chunk: string, generation: number): void {
    const combined = this.partialLine + chunk;
    const lines = combined.split('\n');
    this.partialLine = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      this.processLine(trimmed, generation);
    }
  }

  private processLine(line: string, generation: number): void {
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
      void buildTrafficSummary(entry, durationMs, { logDir: this.logDir })
        .then((summary) => {
          if (this.isActive(generation)) {
            this.handlers.onTraffic(summary);
          }
        })
        .catch(() => {
          if (this.isActive(generation)) {
            this.handlers.onTraffic(toTrafficSummary(entry, durationMs));
          }
        });
    }
  }

  private isActive(generation: number): boolean {
    return this.running && this.lifecycleGeneration === generation;
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

  const withStats = (
    await Promise.all(
      paths.map(async (filePath) => {
        try {
          return {
            filePath,
            mtime: (await fs.stat(filePath)).mtimeMs,
          };
        } catch {
          return null;
        }
      })
    )
  ).filter((value): value is NonNullable<typeof value> => value !== null);
  withStats.sort((a, b) => a.mtime - b.mtime || comparePaths(a.filePath, b.filePath));
  return withStats.map((x) => x.filePath);
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
