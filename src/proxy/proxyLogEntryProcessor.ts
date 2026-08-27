import { toTrafficSummary } from './proxyTrafficFormat';
import { buildTrafficSummary } from './trafficSummaryBuilder';
import type { ProxyLogEntry, ProxyTrafficSummary } from './types';

export interface ProxyLogEntryProcessorHandlers {
  onTraffic: (summary: ProxyTrafficSummary) => void;
  onError?: (summary: ProxyTrafficSummary) => void;
}

export class ProxyLogEntryProcessor {
  private readonly requestStartedAt = new Map<string, number>();
  private partialLine = '';

  constructor(
    private readonly logDir: string,
    private readonly handlers: ProxyLogEntryProcessorHandlers
  ) {}

  reset(): void {
    this.requestStartedAt.clear();
    this.partialLine = '';
  }

  processChunk(chunk: string, isActive: () => boolean): void {
    const lines = (this.partialLine + chunk).split('\n');
    this.partialLine = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        this.processLine(trimmed, isActive);
      }
    }
  }

  private processLine(line: string, isActive: () => boolean): void {
    const entry = parseProxyLogEntry(line);
    if (!entry || !isActive()) {
      return;
    }

    if (entry.direction === 'error') {
      this.handlers.onError?.(toTrafficSummary(entry));
      return;
    }

    const durationMs = this.resolveDuration(entry);
    if (entry.direction === 'request' || entry.direction === 'response') {
      this.emitTraffic(entry, durationMs, isActive);
    }
  }

  private resolveDuration(entry: ProxyLogEntry): number | undefined {
    const requestId = entry.requestId;
    if (!requestId) {
      return undefined;
    }

    if (entry.direction === 'request') {
      this.requestStartedAt.set(requestId, Date.parse(entry.timestamp));
      return undefined;
    }
    if (entry.direction !== 'response') {
      return undefined;
    }

    const startedAt = this.requestStartedAt.get(requestId);
    this.requestStartedAt.delete(requestId);
    if (startedAt == null || Number.isNaN(startedAt)) {
      return undefined;
    }
    return Math.max(0, Date.parse(entry.timestamp) - startedAt);
  }

  private emitTraffic(
    entry: ProxyLogEntry,
    durationMs: number | undefined,
    isActive: () => boolean
  ): void {
    void buildTrafficSummary(entry, durationMs, { logDir: this.logDir })
      .then((summary) => {
        if (isActive()) {
          this.handlers.onTraffic(summary);
        }
      })
      .catch(() => {
        if (isActive()) {
          this.handlers.onTraffic(toTrafficSummary(entry, durationMs));
        }
      });
  }
}

function parseProxyLogEntry(line: string): ProxyLogEntry | null {
  try {
    return JSON.parse(line) as ProxyLogEntry;
  } catch {
    return null;
  }
}
