import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CURSOR_MODEL_PRICING_CATALOG_METADATA,
  CursorModelPricingProvider,
} from '../../modelEfficiency/cursorModelPricingProvider';

describe('CursorModelPricingProvider', () => {
  const provider = new CursorModelPricingProvider();

  it('returns pricing for known model', () => {
    const pricing = provider.getPricingForModel('composer-2.5');
    assert.ok(pricing);
    assert.equal(pricing.inputPer1M, 0.5);
    assert.equal(pricing.outputPer1M, 2.5);
    assert.equal(pricing.provider, 'Cursor');
  });

  it('returns pricing for catalog variant slug', () => {
    const pricing = provider.getPricingForModel('composer-2.5-fast');
    assert.ok(pricing);
    assert.equal(pricing.modelId, 'composer-2.5-fast');
    assert.equal(pricing.inputPer1M, 3);
    assert.equal(pricing.outputPer1M, 15);
    assert.equal(pricing.cacheReadPer1M, 0.5);
  });

  it('exposes the reviewed catalog snapshot metadata', () => {
    assert.deepEqual(
      provider.getCatalogMetadata(),
      CURSOR_MODEL_PRICING_CATALOG_METADATA
    );
    assert.match(provider.getCatalogMetadata().version, /^cursor-docs-\d{4}-\d{2}-\d{2}$/);
  });

  it('does not assign a fixed rate to normal Auto routing', () => {
    assert.equal(provider.getPricingForModel('auto'), null);
    assert.equal(provider.getPricingForModel('default'), null);
    assert.equal(
      provider.getPricingForModel('legacy-enterprise-auto')?.inputPer1M,
      1.25
    );
  });

  it('returns null for unknown model', () => {
    assert.equal(provider.getPricingForModel('unknown-model-xyz'), null);
  });

  it('returns deduplicated catalog pricing sorted by provider', () => {
    const allPricing = provider.getAllModelPricing();
    assert.ok(allPricing.length > 0);
    assert.ok(allPricing.some((pricing) => pricing.displayName === 'Composer 2.5'));
    assert.ok(allPricing.some((pricing) => pricing.displayName === 'GPT-5'));
  });

  it('includes cache pricing for Anthropic models', () => {
    const pricing = provider.getPricingForModel('claude-4-sonnet');
    assert.ok(pricing);
    assert.equal(pricing.cacheReadPer1M, 0.3);
    assert.equal(pricing.cacheWritePer1M, 3.75);
  });

  it('omits cache write for Composer models', () => {
    const pricing = provider.getPricingForModel('composer-2.5');
    assert.ok(pricing);
    assert.equal(pricing.cacheReadPer1M, 0.2);
    assert.equal(pricing.cacheWritePer1M, undefined);
  });

  it('matches the current visible official model table', () => {
    const expected = [
      ['grok-4.6', 2, 6, 0.5],
      ['grok-4.6-fast', 4, 12, 1],
      ['grok-4.5', 2, 6, 0.5],
      ['grok-4.5-fast', 4, 18, 1],
      ['composer-2.5', 0.5, 2.5, 0.2],
      ['composer-2.5-fast', 3, 15, 0.5],
      ['claude-fable-5', 10, 50, 1],
      ['claude-opus-5', 5, 25, 0.5],
      ['claude-sonnet-5', 2, 10, 0.2],
      ['gemini-3.1-pro', 2, 12, 0.2],
      ['gemini-3.7-flash', 0.75, 3.5, 0.075],
      ['gpt-5.6-luna', 0.2, 1.2, 0.02],
      ['gpt-5.6-sol', 4, 20, 0.4],
      ['gpt-5.6-terra', 2, 12, 0.2],
    ] as const;

    for (const [modelId, input, output, cacheRead] of expected) {
      const pricing = provider.getPricingForModel(modelId);
      assert.ok(pricing, `Expected pricing for ${modelId}`);
      assert.equal(pricing.inputPer1M, input, modelId);
      assert.equal(pricing.outputPer1M, output, modelId);
      assert.equal(pricing.cacheReadPer1M, cacheRead, modelId);
    }

    assert.equal(provider.getPricingForModel('gpt-5.6-luna')?.cacheWritePer1M, 0.25);
    assert.equal(provider.getPricingForModel('gpt-5.6-sol')?.cacheWritePer1M, 5);
    assert.equal(provider.getPricingForModel('gpt-5.6-terra')?.cacheWritePer1M, 2.5);
  });
});
