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
import { buildActiveConversationStatusBarDisplay } from '../ui/presentation/activeConversationStatusBarPresentation';
import {
  formatCostUsd,
  formatTokenCount,
} from '../ui/presentation/tokenCostFormatting';

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
    assert.equal(formatContextPercent(1, 0), '');
  });
});

describe('tokenCostFormatting', () => {
  it('formats token counts at compact-number boundaries', () => {
    assert.equal(formatTokenCount(999), '999');
    assert.equal(formatTokenCount(1500), '1.5k');
    assert.equal(formatTokenCount(1_500_000), '1.5m');
  });

  it('marks costs below one cent and distinguishes estimates', () => {
    assert.equal(formatCostUsd(0.5, false), '<$0.01');
    assert.equal(formatCostUsd(2, true), '$0.02');
    assert.equal(formatCostUsd(2, false), '~$0.02');
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

describe('buildActiveConversationStatusBarDisplay', () => {
  it('renders the empty state without a warning background', () => {
    const display = buildActiveConversationStatusBarDisplay(null, null);

    assert.match(display.text, /comment-discussion/);
    assert.equal(display.tooltip.length > 0, true);
    assert.equal(display.showWarning, false);
  });

  it('renders conversation totals, context usage, and selected composers', () => {
    const display = buildActiveConversationStatusBarDisplay(
      {
        lastFocusedComposerId: 'conversation-123456789',
        selectedComposerIds: ['conversation-123456789', 'conversation-2'],
        sourceKey: COMPOSER_WORKSPACE_DATA_KEY,
      },
      {
        ...emptyTotals(),
        totalDeltaTokens: 1250,
        totalDeltaCostCents: 1.5,
        latestContextUsedTokens: 50_000,
        latestContextMaxTokens: 200_000,
        models: ['gpt-4.1'],
      }
    );

    assert.match(display.text, /conversa/);
    assert.match(display.text, /25%/);
    assert.match(display.text, /1\.3k/);
    assert.match(display.tooltip, /conversation-123456789/);
    assert.match(display.tooltip, /gpt-4\.1/);
    assert.equal(display.showWarning, true);
  });

  it('renders an active conversation without usage data', () => {
    const display = buildActiveConversationStatusBarDisplay(
      {
        lastFocusedComposerId: 'conversation-empty',
        selectedComposerIds: [],
        sourceKey: COMPOSER_WORKSPACE_DATA_KEY,
      },
      null
    );

    assert.match(display.text, /conversa/);
    assert.equal(display.showWarning, false);
    assert.equal(display.tooltip.length > 0, true);
  });

  it('renders billed and live token details with an authoritative cost', () => {
    const display = buildActiveConversationStatusBarDisplay(
      {
        lastFocusedComposerId: 'conversation-detailed',
        selectedComposerIds: [],
        sourceKey: COMPOSER_WORKSPACE_DATA_KEY,
      },
      {
        ...emptyTotals(),
        totalTokens: 2000,
        totalDeltaTokens: 1250,
        totalInputTokens: 1000,
        totalOutputTokens: 1000,
        totalTurnCostCents: 3,
        models: ['gpt-4.1'],
      }
    );

    assert.match(display.text, /2\.0k/);
    assert.match(display.text, /\$0\.03/);
    assert.match(display.tooltip, /conversation-detailed/);
    assert.match(display.tooltip, /gpt-4\.1/);
    assert.equal(display.showWarning, true);
  });

  it('renders the sub-cent estimate for a live-only conversation', () => {
    const display = buildActiveConversationStatusBarDisplay(
      {
        lastFocusedComposerId: 'conversation-small-cost',
        selectedComposerIds: [],
        sourceKey: COMPOSER_WORKSPACE_DATA_KEY,
      },
      {
        ...emptyTotals(),
        totalDeltaTokens: 100,
      }
    );

    assert.match(display.text, /<\$0\.01/);
    assert.equal(display.showWarning, true);
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
