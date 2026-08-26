import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { ModelCatalogEntry, ModelPricing } from '@cursor-accounts/types';
import type { IModelCatalogRepository } from '../../domain/ports/IModelCatalogRepository';
import type { IModelPricingProvider } from '../../domain/ports/IModelPricingProvider';
import { ModelPricingService } from '../../services/modelPricingService';

function createMockCatalog(
  catalog: ModelCatalogEntry[],
  raw: string | null = null
): IModelCatalogRepository {
  return {
    loadModelCatalog: mock.fn(async () => catalog),
    loadModelCatalogRaw: mock.fn(async () => raw),
  };
}

describe('ModelPricingService', () => {
  it('combines catalog and pricing data', async () => {
    const mockCatalog = createMockCatalog([
      {
        name: 'composer-2.5',
        variants: [
          {
            legacySlug: 'composer-2.5',
            displayName: 'Composer 2.5',
            variantStringRepresentation: 'composer-2.5[fast=false]',
            parameterValues: [{ id: 'fast', value: 'false' }],
          },
          {
            legacySlug: 'composer-2.5-fast',
            displayName: 'Composer 2.5 <span>Fast</span>',
            variantStringRepresentation: 'composer-2.5[fast=true]',
            parameterValues: [{ id: 'fast', value: 'true' }],
          },
        ],
      },
    ]);

    const mockPricing: IModelPricingProvider = {
      getCatalogMetadata: () => ({
        version: 'test-catalog',
        sourceUrl: 'https://example.test/pricing',
        retrievedOn: '2026-08-26',
        coverage: 'official-visible-models-plus-legacy-compatibility',
      }),
      getPricingForModel: mock.fn((modelId: string) => {
        if (modelId === 'composer-2.5' || modelId === 'composer-2.5-fast') {
          return {
            modelId,
            displayName: 'Composer 2.5',
            provider: 'Cursor',
            inputPer1M: 0.5,
            outputPer1M: 2.5,
            hiddenByDefault: false,
          } satisfies ModelPricing;
        }
        return null;
      }),
      getAllModelPricing: mock.fn(() => []),
    };

    const service = new ModelPricingService(mockCatalog, mockPricing);
    const results = await service.getModelsWithPricing(
      '/fake/state.vscdb',
      '/fake/ext'
    );

    assert.equal(results.length, 2);
    assert.equal(results[0]?.baseModelId, 'composer-2.5');
    assert.equal(results[1]?.variantName, 'fast=true');
    assert.equal(results[1]?.displayName, 'Composer 2.5 Fast');
    assert.deepEqual(results[1]?.parameters, [{ id: 'fast', value: 'true' }]);
    assert.ok(results[1]?.pricing);
  });

  it('returns enabled models based on toggle state', async () => {
    const raw = JSON.stringify({
      availableDefaultModels2: [
        {
          name: 'composer-2.5',
          defaultOn: true,
          variants: [
            {
              legacySlug: 'composer-2.5',
              displayName: 'Composer 2.5',
              variantStringRepresentation: 'composer-2.5[fast=false]',
            },
          ],
        },
        {
          name: 'gpt-5.5',
          defaultOn: true,
          variants: [
            {
              legacySlug: 'gpt-5.5',
              displayName: 'GPT-5.5',
              variantStringRepresentation: 'gpt-5.5[]',
            },
          ],
        },
        {
          name: 'claude-sonnet-4-5',
          defaultOn: false,
          variants: [
            {
              legacySlug: 'claude-sonnet-4-5',
              displayName: 'Claude Sonnet 4.5',
              variantStringRepresentation: 'claude-sonnet-4-5[]',
            },
          ],
        },
      ],
      aiSettings: {
        modelOverrideEnabled: ['claude-sonnet-4-5'],
        modelOverrideDisabled: ['gpt-5.5'],
      },
    });

    const mockCatalog = createMockCatalog([], raw);

    const mockPricing: IModelPricingProvider = {
      getCatalogMetadata: () => ({
        version: 'test-catalog',
        sourceUrl: 'https://example.test/pricing',
        retrievedOn: '2026-08-26',
        coverage: 'official-visible-models-plus-legacy-compatibility',
      }),
      getPricingForModel: mock.fn((modelId: string) => ({
        modelId,
        displayName: modelId,
        provider: 'Cursor',
        inputPer1M: 1,
        outputPer1M: 2,
        hiddenByDefault: false,
      })),
      getAllModelPricing: mock.fn(() => []),
    };

    const service = new ModelPricingService(mockCatalog, mockPricing);
    const results = await service.getEnabledModelsWithPricing(
      '/fake/state.vscdb',
      '/fake/ext'
    );

    const baseModelIds = results.map((model) => model.baseModelId);
    assert.ok(baseModelIds.includes('composer-2.5'));
    assert.ok(baseModelIds.includes('claude-sonnet-4-5'));
    assert.ok(!baseModelIds.includes('gpt-5.5'));
  });

  it('falls back to all pricing when catalog is empty', async () => {
    const mockCatalog = createMockCatalog([]);

    const mockPricing: IModelPricingProvider = {
      getCatalogMetadata: () => ({
        version: 'test-catalog',
        sourceUrl: 'https://example.test/pricing',
        retrievedOn: '2026-08-26',
        coverage: 'official-visible-models-plus-legacy-compatibility',
      }),
      getPricingForModel: mock.fn(() => null),
      getAllModelPricing: mock.fn(() => [
        {
          modelId: 'composer-2.5',
          displayName: 'Composer 2.5',
          provider: 'Cursor',
          inputPer1M: 0.5,
          outputPer1M: 2.5,
          hiddenByDefault: false,
        },
      ]),
    };

    const service = new ModelPricingService(mockCatalog, mockPricing);
    const results = await service.getModelsWithPricing(
      '/fake/state.vscdb',
      '/fake/ext'
    );

    assert.equal(results.length, 1);
    assert.equal(results[0]?.pricing?.modelId, 'composer-2.5');
  });

  it('handles models without pricing', async () => {
    const mockCatalog = createMockCatalog([{ name: 'unknown-model' }]);

    const mockPricing: IModelPricingProvider = {
      getCatalogMetadata: () => ({
        version: 'test-catalog',
        sourceUrl: 'https://example.test/pricing',
        retrievedOn: '2026-08-26',
        coverage: 'official-visible-models-plus-legacy-compatibility',
      }),
      getPricingForModel: mock.fn(() => null),
      getAllModelPricing: mock.fn(() => []),
    };

    const service = new ModelPricingService(mockCatalog, mockPricing);
    const results = await service.getModelsWithPricing(
      '/fake/state.vscdb',
      '/fake/ext'
    );

    assert.equal(results.length, 1);
    assert.equal(results[0]?.pricing, null);
  });

  it('propagates repository errors', async () => {
    const mockCatalog: IModelCatalogRepository = {
      loadModelCatalog: mock.fn(async () => {
        throw new Error('Database locked');
      }),
      loadModelCatalogRaw: mock.fn(async () => {
        throw new Error('Database locked');
      }),
    };

    const mockPricing: IModelPricingProvider = {
      getCatalogMetadata: () => ({
        version: 'test-catalog',
        sourceUrl: 'https://example.test/pricing',
        retrievedOn: '2026-08-26',
        coverage: 'official-visible-models-plus-legacy-compatibility',
      }),
      getPricingForModel: mock.fn(() => null),
      getAllModelPricing: mock.fn(() => []),
    };

    const service = new ModelPricingService(mockCatalog, mockPricing);
    await assert.rejects(
      () => service.getModelsWithPricing('/fake/state.vscdb', '/fake/ext'),
      /Failed to load model pricing: Database locked/
    );
  });
});
