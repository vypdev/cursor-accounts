import { watch, type FSWatcher } from 'fs';
import { ProxyLogEntryProcessor } from './proxyLogEntryProcessor';
import {
  findProxyLogFiles,
  readProxyLogFile,
  type ProxyLogFileMetadata,
} from './proxyLogFileReader';
import type { ProxyTrafficSummary } from './types';

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
  private dirWatcher: FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readChain: Promise<void> = Promise.resolve();
  private readonly entryProcessor: ProxyLogEntryProcessor;

  constructor(
    private readonly logDir: string,
    private readonly handlers: ProxyLogTailerHandlers,
    private readonly options: ProxyLogTailerOptions = {}
  ) {
    this.entryProcessor = new ProxyLogEntryProcessor(logDir, handlers);
  }

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
    this.dirWatcher?.close();
    this.dirWatcher = null;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.clearActiveFile();
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
    const files = await findProxyLogFiles(this.logDir);
    if (!this.isActive(generation)) {
      return;
    }

    const latest = files.at(-1);
    if (!latest) {
      this.clearActiveFile();
      this.handlers.onLogFileResolved?.(null);
      return;
    }
    if (this.currentFilePath === latest.filePath) {
      return;
    }

    this.currentFilePath = latest.filePath;
    this.entryProcessor.reset();
    this.fileOffset = this.initialOffset(latest, isInitial);
    this.handlers.onLogFileResolved?.(latest.filePath);
  }

  private initialOffset(file: ProxyLogFileMetadata, isInitial: boolean): number {
    if (!isInitial || !this.options.tailFromStart) {
      return file.size;
    }
    const maxBytes = this.options.tailFromStartMaxBytes ?? 64 * 1024;
    return Math.max(0, file.size - maxBytes);
  }

  private async readNewLines(generation: number): Promise<void> {
    const filePath = this.currentFilePath;
    if (!this.isActive(generation) || !filePath) {
      return;
    }

    const result = await readProxyLogFile(filePath, this.fileOffset);
    if (!this.isActive(generation) || this.currentFilePath !== filePath) {
      return;
    }
    if (result.kind === 'missing') {
      this.clearActiveFile();
      this.handlers.onLogFileResolved?.(null);
      return;
    }
    if (result.truncated) {
      this.entryProcessor.reset();
    }
    if (result.kind === 'unchanged') {
      this.fileOffset = result.truncated ? 0 : this.fileOffset;
      return;
    }

    this.fileOffset = result.nextOffset;
    this.entryProcessor.processChunk(result.chunk, () => this.isActive(generation));
  }

  private clearActiveFile(): void {
    this.currentFilePath = null;
    this.fileOffset = 0;
    this.entryProcessor.reset();
  }

  private isActive(generation: number): boolean {
    return this.running && this.lifecycleGeneration === generation;
  }
}

export { listProxyLogFiles } from './proxyLogFileReader';
