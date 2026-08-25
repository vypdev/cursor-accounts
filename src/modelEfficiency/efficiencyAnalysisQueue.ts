import * as extensionLog from '../logging/extensionLog';
import type { PromptMetadata } from './types';

export type EfficiencyAnalysisRunner = (
  metadata: PromptMetadata
) => Promise<void>;

export type EfficiencyAnalysisErrorHandler = (
  error: unknown,
  metadata: PromptMetadata
) => void;

/**
 * Bounds concurrent model-efficiency analyses and deduplicates queued work.
 * The queue deliberately has no VS Code dependencies so its lifecycle can be
 * tested independently from the analysis workflow.
 */
export class EfficiencyAnalysisQueue {
  private readonly pending: PromptMetadata[] = [];
  private readonly scheduled = new Set<string>();
  private inFlight = 0;

  constructor(
    private readonly runAnalysis: EfficiencyAnalysisRunner,
    private readonly onError: EfficiencyAnalysisErrorHandler,
    private readonly maxConcurrent = 2
  ) {}

  enqueue(metadata: PromptMetadata): void {
    const key = this.getKey(metadata);
    if (this.scheduled.has(key)) {
      return;
    }

    this.scheduled.add(key);
    if (this.inFlight >= this.maxConcurrent) {
      this.pending.push(metadata);
      extensionLog.debug(
        `[EfficiencyAnalysisQueue] Queued analysis (${this.inFlight} in flight)`
      );
      return;
    }

    this.start(metadata);
  }

  private start(metadata: PromptMetadata): void {
    this.inFlight += 1;

    void Promise.resolve()
      .then(() => this.runAnalysis(metadata))
      .catch((error: unknown) => this.onError(error, metadata))
      .finally(() => {
        this.scheduled.delete(this.getKey(metadata));
        this.inFlight -= 1;
        this.drainPending();
      });
  }

  private drainPending(): void {
    while (this.inFlight < this.maxConcurrent && this.pending.length > 0) {
      const next = this.pending.shift();
      if (next) {
        this.start(next);
      }
    }
  }

  private getKey(metadata: PromptMetadata): string {
    return `${metadata.conversationId}:${metadata.timestamp}:${metadata.prompt.slice(0, 64)}`;
  }
}
