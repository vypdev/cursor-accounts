import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildLiveTokenTrafficSummary,
  buildTurnEndedTrafficSummary,
  type RunSseTrafficContext,
} from '../../application/services/runSseTrafficPolicy';

const context: RunSseTrafficContext = {
  timestamp: '2026-08-27T12:00:00.000Z',
  url: 'https://api2.cursor.sh/RunSSE',
  host: 'api2.cursor.sh',
  endpoint: '/RunSSE',
  rpcPath: '/RunSSE',
  bidiRequestId: 'bidi-1',
  httpRequestId: 'http-1',
  isCursorHost: true,
  modelId: 'composer-2.5',
  conversationId: 'conversation-1',
};

describe('runSseTrafficPolicy', () => {
  it('builds a live event with calculated cost provenance', () => {
    const summary = buildLiveTokenTrafficSummary(
      {
        accumulatedTokens: 120,
        latestDelta: 20,
        agent: { streamingTokens: 120, usageEvent: 'token_delta' },
      },
      context,
      {
        costCalculator: {
          estimateDeltaCost: () => ({
            costCents: 0.1234567,
            source: 'model_pricing',
            pricingSnapshotVersion: 'pricing-v1',
          }),
          calculateDeltaCost: () => 0,
          estimateTurnCost: () => ({ costCents: 0, source: 'fallback' }),
          calculateTurnCost: () => 0,
        },
      }
    );

    assert.equal(summary.isLiveTokenUpdate, true);
    assert.equal(summary.liveTokenData?.deltaCostCents, 0.1234567);
    assert.equal(summary.liveTokenData?.costSource, 'model_pricing');
    assert.equal(summary.liveTokenData?.pricingSnapshotVersion, 'pricing-v1');
    assert.equal(summary.insights?.agent?.conversationId, 'conversation-1');
    assert.equal(summary.httpRequestId, 'http-1');
  });

  it('marks an explicitly supplied live cost as provided', () => {
    const summary = buildLiveTokenTrafficSummary(
      {
        accumulatedTokens: 10,
        latestDelta: 10,
        deltaCostCents: 0,
        agent: { streamingTokens: 10, usageEvent: 'token_delta' },
      },
      context
    );

    assert.equal(summary.liveTokenData?.deltaCostCents, 0);
    assert.equal(summary.liveTokenData?.costSource, 'provided');
  });

  it('preserves authoritative server zero cost over carried or calculated values', () => {
    const summary = buildTurnEndedTrafficSummary(
      {
        inputTokens: 100,
        outputTokens: 50,
        totalCents: 0,
        agent: {
          totalCents: 999,
          costSource: 'fallback',
          usageEvent: 'turn_ended',
        },
      },
      context,
      {
        costCalculator: {
          estimateDeltaCost: () => ({ costCents: 1, source: 'fallback' }),
          calculateDeltaCost: () => 1,
          estimateTurnCost: () => ({ costCents: 999, source: 'fallback' }),
          calculateTurnCost: () => 999,
        },
      }
    );

    assert.equal(summary.isTurnEnded, true);
    assert.equal(summary.insights?.agent?.totalCents, 0);
    assert.equal(summary.insights?.agent?.costSource, 'server');
    assert.equal(summary.insights?.tokens?.totalCents, 0);
  });

  it('uses model pricing when a turn has no authoritative server total', () => {
    const summary = buildTurnEndedTrafficSummary(
      {
        inputTokens: 100,
        outputTokens: 50,
        agent: { usageEvent: 'turn_ended' },
      },
      context,
      {
        costCalculator: {
          estimateDeltaCost: () => ({ costCents: 0, source: 'fallback' }),
          calculateDeltaCost: () => 0,
          estimateTurnCost: () => ({
            costCents: 1.5,
            source: 'model_pricing',
            pricingSnapshotVersion: 'pricing-v1',
          }),
          calculateTurnCost: () => 1.5,
        },
      }
    );

    assert.equal(summary.insights?.agent?.totalCents, 1.5);
    assert.equal(summary.insights?.agent?.costSource, 'model_pricing');
    assert.equal(
      summary.insights?.agent?.pricingSnapshotVersion,
      'pricing-v1'
    );
    assert.equal(summary.insights?.tokens?.totalCents, undefined);
  });

  it('does not publish unsupported mixed or unknown cost provenance', () => {
    const summary = buildLiveTokenTrafficSummary(
      {
        accumulatedTokens: 10,
        latestDelta: 10,
        agent: { streamingTokens: 10, usageEvent: 'token_delta' },
      },
      context,
      {
        costCalculator: {
          estimateDeltaCost: () => ({ costCents: 1, source: 'unknown' }),
          calculateDeltaCost: () => 1,
          estimateTurnCost: () => ({ costCents: 0, source: 'unknown' }),
          calculateTurnCost: () => 0,
        },
      }
    );

    assert.equal(summary.liveTokenData?.deltaCostCents, 1);
    assert.equal(summary.liveTokenData?.costSource, undefined);
  });
});
