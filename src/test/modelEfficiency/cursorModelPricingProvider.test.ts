import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CursorModelPricingProvider } from '../../modelEfficiency/cursorModelPricingProvider';

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
});
