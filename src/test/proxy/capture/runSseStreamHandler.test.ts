import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RunSseStreamHandler } from '../../../proxy/capture/runSseStreamHandler';
import { ProxyLiveCostCalculator } from '../../../domain/services/ProxyLiveCostCalculator';
import { CursorModelPricingProvider } from '../../../modelEfficiency/cursorModelPricingProvider';

describe('RunSseStreamHandler', () => {
  it('emits live token update summary with model-aware delta cost', () => {
    const summaries: unknown[] = [];
    const handler = new RunSseStreamHandler(
      (s) => summaries.push(s),
      {
        costCalculator: new ProxyLiveCostCalculator(
          new CursorModelPricingProvider()
        ),
        resolveModelId: () => 'composer-2.5',
      }
    );

    handler.emitLiveTokenUpdate(
      {
        accumulatedTokens: 1000,
        latestDelta: 1000,
        agent: { streamingTokens: 1000, usageEvent: 'token_delta' },
      },
      {
        url: 'https://api2.cursor.sh/RunSSE',
        host: 'api2.cursor.sh',
        httpRequestId: 'http-1',
        bidiRequestId: 'bidi-1',
        isCursorHost: true,
      }
    );

    assert.equal(summaries.length, 1);
    const summary = summaries[0] as {
      isLiveTokenUpdate?: boolean;
      liveTokenData?: { modelId?: string; deltaCostCents?: number };
    };
    assert.equal(summary.isLiveTokenUpdate, true);
    assert.equal(summary.liveTokenData?.modelId, 'composer-2.5');
    assert.ok((summary.liveTokenData?.deltaCostCents ?? 0) > 0);
  });

  it('resolves conversationId for live token updates from bidi session map', () => {
    const summaries: unknown[] = [];
    const handler = new RunSseStreamHandler((s) => summaries.push(s), {
      resolveConversationId: (bidiRequestId) =>
        bidiRequestId === 'bidi-1' ? 'conv-abc' : undefined,
    });

    handler.emitLiveTokenUpdate(
      {
        accumulatedTokens: 50,
        latestDelta: 50,
        agent: { streamingTokens: 50, usageEvent: 'token_delta' },
      },
      {
        url: 'https://api2.cursor.sh/RunSSE',
        host: 'api2.cursor.sh',
        bidiRequestId: 'bidi-1',
        isCursorHost: true,
      }
    );

    const summary = summaries[0] as {
      insights?: {
        agent?: { conversationId?: string };
        context?: { conversationId?: string };
      };
    };
    assert.equal(summary.insights?.agent?.conversationId, 'conv-abc');
    assert.equal(summary.insights?.context?.conversationId, 'conv-abc');
  });
});
