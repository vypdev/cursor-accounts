import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  ModelCatalogEntry} from '../../modelEfficiency/modelConfigResolver';
import {
  buildVariantString,
  parseModelCatalog,
  resolveModelConfig,
} from '../../modelEfficiency/modelConfigResolver';
import { required } from '../testUtils';

const testCatalog: ModelCatalogEntry[] = [
  {
    name: 'default',
    serverModelName: 'default',
    variants: [
      {
        parameterValues: [],
        legacySlug: 'default',
        variantStringRepresentation: 'default[]',
        isMaxMode: false,
        displayName: 'Auto',
      },
    ],
  },
  {
    name: 'composer-2.5',
    serverModelName: 'composer-2.5',
    variants: [
      {
        parameterValues: [{ id: 'fast', value: 'true' }],
        legacySlug: 'composer-2.5-fast',
        variantStringRepresentation: 'composer-2.5[fast=true]',
        isMaxMode: false,
        displayName: 'Composer 2.5 <span>Fast</span>',
      },
      {
        parameterValues: [{ id: 'fast', value: 'false' }],
        legacySlug: 'composer-2.5',
        variantStringRepresentation: 'composer-2.5[fast=false]',
        isMaxMode: false,
        displayName: 'Composer 2.5',
      },
    ],
  },
  {
    name: 'claude-sonnet-4-5',
    serverModelName: 'claude-sonnet-4-5',
    variants: [
      {
        parameterValues: [
          { id: 'thinking', value: 'true' },
          { id: 'context', value: '200k' },
        ],
        legacySlug: 'claude-4.5-sonnet-thinking',
        variantStringRepresentation:
          'claude-sonnet-4-5[context=200k,thinking=true]',
        isMaxMode: false,
        displayName: 'Sonnet 4.5 Thinking',
      },
    ],
  },
];

describe('modelConfigResolver', () => {
  it('buildVariantString sorts parameters for stable matching', () => {
    assert.equal(
      buildVariantString('claude-sonnet-4-5', [
        { id: 'thinking', value: 'true' },
        { id: 'context', value: '200k' },
      ]),
      'claude-sonnet-4-5[context=200k,thinking=true]'
    );
  });

  it('parseModelCatalog reads availableDefaultModels2', () => {
    const catalog = parseModelCatalog(
      JSON.stringify({ availableDefaultModels2: testCatalog })
    );
    assert.equal(catalog.length, 3);
    assert.equal(required(catalog[1], 'catalog entry').name, 'composer-2.5');
  });

  it('resolves composer-2.5 fast variant', () => {
    const result = resolveModelConfig(
      {
        modelName: 'composer-2.5',
        maxMode: false,
        selectedModels: [
          {
            modelId: 'composer-2.5',
            parameters: [{ id: 'fast', value: 'true' }],
          },
        ],
      },
      testCatalog
    );

    assert.equal(result.slug, 'composer-2.5-fast');
    assert.equal(result.resolved, true);
    assert.equal(result.displayName, 'Composer 2.5 Fast');
  });

  it('resolves composer-2.5 base variant', () => {
    const result = resolveModelConfig(
      {
        modelName: 'composer-2.5',
        maxMode: false,
        selectedModels: [
          {
            modelId: 'composer-2.5',
            parameters: [{ id: 'fast', value: 'false' }],
          },
        ],
      },
      testCatalog
    );

    assert.equal(result.slug, 'composer-2.5');
    assert.equal(result.resolved, true);
  });

  it('resolves thinking variant from selected model id, not modelName', () => {
    const result = resolveModelConfig(
      {
        modelName: 'composer-2.5',
        maxMode: false,
        selectedModels: [
          {
            modelId: 'claude-sonnet-4-5',
            parameters: [
              { id: 'thinking', value: 'true' },
              { id: 'context', value: '200k' },
            ],
          },
        ],
      },
      testCatalog
    );

    assert.equal(result.slug, 'claude-4.5-sonnet-thinking');
    assert.equal(result.baseModelId, 'claude-sonnet-4-5');
    assert.equal(result.resolved, true);
  });

  it('falls back when selectedModels is missing', () => {
    const result = resolveModelConfig(
      { modelName: 'composer-2.5', maxMode: false },
      testCatalog
    );

    assert.equal(result.slug, 'composer-2.5');
    assert.equal(result.resolved, false);
  });

  it('resolves default auto selection', () => {
    const result = resolveModelConfig(
      {
        modelName: 'default',
        maxMode: false,
        selectedModels: [{ modelId: 'default', parameters: [] }],
      },
      testCatalog
    );

    assert.equal(result.slug, 'default');
    assert.equal(result.resolved, true);
  });

  it('falls back when catalog has no entry', () => {
    const result = resolveModelConfig(
      {
        modelName: 'unknown-model',
        maxMode: false,
        selectedModels: [
          {
            modelId: 'unknown-model',
            parameters: [{ id: 'fast', value: 'true' }],
          },
        ],
      },
      testCatalog
    );

    assert.equal(result.slug, 'unknown-model');
    assert.equal(result.resolved, false);
  });
});
