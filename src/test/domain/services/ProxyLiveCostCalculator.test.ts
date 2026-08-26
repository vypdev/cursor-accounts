import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ModelPricing } from '@cursor-accounts/types';
import type { IModelPricingProvider } from '../../../domain/ports/IModelPricingProvider';
import { ProxyLiveCostCalculator } from '../../../domain/services/ProxyLiveCostCalculator';

function mockProvider(
  pricing: ModelPricing | null
): IModelPricingProvider {
  return {
    getCatalogMetadata: () => ({
      version: 'test-catalog',
      sourceUrl: 'https://example.test/pricing',
      retrievedOn: '2026-08-26',
      coverage: 'official-visible-models-plus-legacy-compatibility',
    }),
    getPricingForModel: () => pricing,
    getAllModelPricing: () => (pricing ? [pricing] : []),
  };
}

describe('ProxyLiveCostCalculator', () => {
  it('calculateDeltaCost uses blended input/output rate for known model', () => {
    const calculator = new ProxyLiveCostCalculator(
      mockProvider({
        modelId: 'composer-2.5',
        displayName: 'Composer 2.5',
        provider: 'Cursor',
        inputPer1M: 0.5,
        outputPer1M: 2.5,
        hiddenByDefault: false,
      })
    );

    const cost = calculator.calculateDeltaCost(1000, 'composer-2.5');
    assert.ok(Math.abs(cost - 0.15) < 0.01);
  });

  it('calculateDeltaCost uses fallback rate for unknown model', () => {
    const calculator = new ProxyLiveCostCalculator(mockProvider(null), () => 4);
    const cost = calculator.calculateDeltaCost(1000, 'unknown-model');
    assert.ok(Math.abs(cost - 0.4) < 0.01);
  });

  it('calculateDeltaCost returns 0 for non-positive deltas', () => {
    const calculator = new ProxyLiveCostCalculator(mockProvider(null));
    assert.equal(calculator.calculateDeltaCost(0, 'composer-2.5'), 0);
    assert.equal(calculator.calculateDeltaCost(-5, 'composer-2.5'), 0);
    assert.equal(
      calculator.calculateDeltaCost(Number.MAX_SAFE_INTEGER + 1, 'composer-2.5'),
      0
    );
  });

  it('rounds floating-point noise without discarding fractional cents', () => {
    const calculator = new ProxyLiveCostCalculator(
      mockProvider({
        modelId: 'fractional-model',
        displayName: 'Fractional Model',
        provider: 'Unknown',
        inputPer1M: 0.1,
        outputPer1M: 0.2,
        hiddenByDefault: false,
      })
    );

    assert.equal(
      calculator.calculateTurnCost(
        { inputTokens: 3, outputTokens: 3 },
        'fractional-model'
      ),
      0.00009
    );
  });

  it('ignores non-finite and negative token counts', () => {
    const calculator = new ProxyLiveCostCalculator(mockProvider(null), () => 4);

    assert.equal(calculator.calculateDeltaCost(Number.NaN, 'unknown-model'), 0);
    assert.equal(calculator.calculateDeltaCost(Number.POSITIVE_INFINITY, 'unknown-model'), 0);
    assert.equal(
      calculator.calculateTurnCost(
        {
          inputTokens: -100,
          outputTokens: Number.NaN,
          cacheReadTokens: Number.POSITIVE_INFINITY,
        },
        'unknown-model'
      ),
      0
    );
  });

  it('calculateTurnCost applies input/output/cache breakdown', () => {
    const calculator = new ProxyLiveCostCalculator(
      mockProvider({
        modelId: 'claude-sonnet-4-5',
        displayName: 'Claude 4.5 Sonnet',
        provider: 'Anthropic',
        inputPer1M: 3,
        outputPer1M: 15,
        cacheReadPer1M: 0.3,
        cacheWritePer1M: 3.75,
        hiddenByDefault: false,
      })
    );

    const cost = calculator.calculateTurnCost(
      {
        inputTokens: 10_000,
        outputTokens: 2000,
        cacheReadTokens: 5000,
        cacheWriteTokens: 1000,
      },
      'claude-sonnet-4-5'
    );

    assert.ok(Math.abs(cost - 6.525) < 0.05);
  });
});
