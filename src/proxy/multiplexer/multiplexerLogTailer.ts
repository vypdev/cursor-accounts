import * as fs from 'fs/promises';
import { watch, type FSWatcher } from 'fs';
import { formatMultiplexerLogLine } from './formatMultiplexerLogLine';
import {
  listMultiplexerLogFiles,
  type MultiplexerLogEntry,
} from './multiplexerEventLogger';
const POLL_INTERVAL_MS = 500;

export interface MultiplexerLogTailerHandlers {
  onLogLine: (line: string) => void;
  onLogFileResolved?: (filePath: string | null) => void;
}

export interface MultiplexerLogTailerOptions {
  pollIntervalMs?: number;
  /** When true, replay the last portion of the active log on start. */
  tailFromStart?: boolean;
  /** Max bytes to read when tailFromStart is enabled. */
  tailFromStartMaxBytes?: number;
}

/**
 * Tails multiplexor JSONL logs and emits formatted lines for the Output channel.
 */
export class MultiplexerLogTailer {
  private running = false;
  private currentFilePath: string | null = null;
  private fileOffset = 0;
  private partialLine = '';
  private dirWatcher: FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly logDir: string,
    private readonly handlers: MultiplexerLogTailerHandlers,
    private readonly options: MultiplexerLogTailerOptions = {}
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
    const logFiles = await listMultiplexerLogFiles(this.logDir);
    if (logFiles.length === 0) {
      this.handlers.onLogFileResolved?.(null);
      return;
    }

    const latest = logFiles[logFiles.length - 1]!;

    if (this.currentFilePath === latest) {
      return;
    }

    this.currentFilePath = latest;
    this.partialLine = '';

    if (isInitial && this.options.tailFromStart) {
      const stat = await fs.stat(latest);
      const maxBytes = this.options.tailFromStartMaxBytes ?? 64 * 1024;
      this.fileOffset = Math.max(0, stat.size - maxBytes);
    } else {
      const stat = await fs.stat(latest);
      this.fileOffset = stat.size;
    }

    this.handlers.onLogFileResolved?.(latest);
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
    let entry: MultiplexerLogEntry;
    try {
      entry = JSON.parse(line) as MultiplexerLogEntry;
    } catch {
      return;
    }

    if (entry.component !== 'multiplexer' || !entry.event) {
      return;
    }

    const formatted = formatMultiplexerLogLine(entry);
    if (formatted) {
      this.handlers.onLogLine(formatted);
    }
  }
}
