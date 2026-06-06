import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConversationTokenTotals } from '../application/types/agentPersistence';
import {
  COMPOSER_WORKSPACE_DATA_KEY,
  type ActiveConversationState,
} from '../application/types/activeConversation';
import {
  ActiveConversationStatusBar,
  formatContextPercent,
  resolveConversationDisplayTotals,
} from '../ui/activeConversationStatusBar';

function emptyTotals(): ConversationTokenTotals {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalTokens: 0,
    totalDeltaTokens: 0,
    totalDeltaCostCents: 0,
    totalTurnCostCents: 0,
    deltaMinuteBuckets: 0,
    agentCount: 0,
    models: [],
    startedAt: 0,
    endedAt: 0,
  };
}

class MockTracker {
  private listener?: (state: ActiveConversationState | null) => void;

  onChange(listener: (state: ActiveConversationState | null) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  emit(state: ActiveConversationState | null): void {
    this.listener?.(state);
  }

  async tickNow(): Promise<void> {}
}

function createContext() {
  return {
    extensionPath: '/tmp/extension',
    subscriptions: [] as { dispose(): void }[],
  } as never;
}

describe('formatContextPercent', () => {
  it('formats whole and fractional percentages', () => {
    assert.equal(formatContextPercent(50_000, 200_000), '25%');
    assert.equal(formatContextPercent(33_333, 100_000), '33.3%');
  });
});

describe('resolveConversationDisplayTotals', () => {
  it('prefers live deltas when they exceed billed totals', () => {
    const result = resolveConversationDisplayTotals({
      ...emptyTotals(),
      totalTokens: 1000,
      totalDeltaTokens: 1250,
      totalDeltaCostCents: 0.5,
      totalTurnCostCents: 0.4,
    });

    assert.equal(result.tokens, 1250);
    assert.equal(result.costCents, 0.5);
    assert.equal(result.costAuthoritative, false);
  });

  it('uses billed totals and cost when they dominate', () => {
    const result = resolveConversationDisplayTotals({
      ...emptyTotals(),
      totalTokens: 2000,
      totalDeltaTokens: 500,
      totalDeltaCostCents: 0.2,
      totalTurnCostCents: 1.5,
    });

    assert.equal(result.tokens, 2000);
    assert.equal(result.costCents, 1.5);
    assert.equal(result.costAuthoritative, true);
  });
});

describe('ActiveConversationStatusBar', () => {
  it('loads totals when the focused conversation changes', async () => {
    const tracker = new MockTracker();
    const loads: string[] = [];
    const statusBar = new ActiveConversationStatusBar(
      createContext(),
      tracker as never,
      async (conversationId) => {
        loads.push(conversationId);
        return {
          ...emptyTotals(),
          totalDeltaTokens: 1500,
          totalDeltaCostCents: 0.75,
        };
      }
    );

    statusBar.start();
    tracker.emit({
      lastFocusedComposerId: 'conv-abc-123',
      selectedComposerIds: [],
      sourceKey: COMPOSER_WORKSPACE_DATA_KEY,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(loads, ['conv-abc-123']);
    assert.equal(statusBar.getCurrentTotals()?.totalDeltaTokens, 1500);
  });

  it('refreshes totals only after usage is persisted', async () => {
    const tracker = new MockTracker();
    let loadCount = 0;
    const statusBar = new ActiveConversationStatusBar(
      createContext(),
      tracker as never,
      async () => {
        loadCount += 1;
        return {
          ...emptyTotals(),
          totalDeltaTokens: loadCount * 100,
          totalDeltaCostCents: loadCount * 0.1,
        };
      }
    );

    statusBar.start();
    tracker.emit({
      lastFocusedComposerId: 'conv-live',
      selectedComposerIds: [],
      sourceKey: COMPOSER_WORKSPACE_DATA_KEY,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(loadCount, 1);

    statusBar.notifyUsagePersisted('conv-other', 'prof-1');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(loadCount, 1);

    statusBar.notifyUsagePersisted('conv-live', 'prof-1');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(loadCount, 2);
    assert.equal(statusBar.getCurrentTotals()?.totalDeltaTokens, 200);
  });
});
