import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EfficiencyAnalysisQueue } from '../../modelEfficiency/efficiencyAnalysisQueue';
import type { PromptMetadata } from '../../modelEfficiency/types';

function metadata(prompt: string, timestamp = 1): PromptMetadata {
  return {
    timestamp,
    prompt,
    model: 'model-a',
    attachments: [],
    conversationId: 'conversation-a',
    workspaceRoots: [],
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('EfficiencyAnalysisQueue', () => {
  it('limits concurrency, preserves FIFO order, and deduplicates pending work', async () => {
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    const queue = new EfficiencyAnalysisQueue(async (item) => {
      started.push(item.prompt);
      await new Promise<void>((resolve) => releases.set(item.prompt, resolve));
    }, () => {});

    queue.enqueue(metadata('first'));
    queue.enqueue(metadata('second', 2));
    queue.enqueue(metadata('third', 3));
    queue.enqueue(metadata('third', 3));
    await flushMicrotasks();

    assert.deepEqual(started, ['first', 'second']);

    releases.get('first')?.();
    await flushMicrotasks();
    assert.deepEqual(started, ['first', 'second', 'third']);

    releases.get('second')?.();
    releases.get('third')?.();
    await flushMicrotasks();
  });

  it('reports failures and allows the same work to be retried afterwards', async () => {
    const failures: Array<{ error: unknown; prompt: string }> = [];
    let attempts = 0;
    const queue = new EfficiencyAnalysisQueue(async (item) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('temporary failure');
      }
      assert.equal(item.prompt, 'retryable');
    }, (error, item) => {
      failures.push({ error, prompt: item.prompt });
    });

    queue.enqueue(metadata('retryable'));
    await flushMicrotasks();
    queue.enqueue(metadata('retryable'));
    await flushMicrotasks();

    assert.equal(attempts, 2);
    assert.equal(failures.length, 1);
    assert.equal((failures[0]?.error as Error).message, 'temporary failure');
    assert.equal(failures[0]?.prompt, 'retryable');
  });
});
