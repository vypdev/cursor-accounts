import { describe, expect, it } from 'vitest';
import type { ModelPricingDisplayData } from '../types';
import {
  extractParameterDimensions,
  extractParameterValues,
  filterModelsByParameters,
  formatDimensionLabel,
  hasActiveFilters,
  modelMatchesFilters,
} from './pricesModalFilters';

const sampleModels: ModelPricingDisplayData[] = [
  {
    modelId: 'composer-2.5',
    displayName: 'Composer 2.5',
    provider: 'Cursor',
    inputPer1M: 0.5,
    outputPer1M: 2.5,
    parameters: [{ id: 'fast', value: 'false' }],
  },
  {
    modelId: 'composer-2.5-fast',
    displayName: 'Composer 2.5 Fast',
    provider: 'Cursor',
    inputPer1M: 0.5,
    outputPer1M: 2.5,
    parameters: [{ id: 'fast', value: 'true' }],
  },
  {
    modelId: 'claude-4.5-sonnet',
    displayName: 'Claude 4.5 Sonnet',
    provider: 'Anthropic',
    inputPer1M: 3,
    outputPer1M: 15,
    parameters: [
      { id: 'thinking', value: 'true' },
      { id: 'context', value: '200k' },
    ],
  },
  {
    modelId: 'gpt-5',
    displayName: 'GPT-5',
    provider: 'OpenAI',
    inputPer1M: 1.25,
    outputPer1M: 10,
    parameters: [{ id: 'reasoning', value: 'extended' }],
  },
  {
    modelId: 'gemini-3.1-pro',
    displayName: 'Gemini 3.1 Pro',
    provider: 'Google',
    inputPer1M: 2,
    outputPer1M: 12,
  },
];

describe('pricesModalFilters', () => {
  it('extracts unique parameter dimensions from model data', () => {
    expect(extractParameterDimensions(sampleModels)).toEqual([
      'context',
      'fast',
      'reasoning',
      'thinking',
    ]);
  });

  it('extracts unique values for a dimension', () => {
    expect(extractParameterValues(sampleModels, 'fast')).toEqual(['false', 'true']);
    expect(extractParameterValues(sampleModels, 'reasoning')).toEqual(['extended']);
    expect(extractParameterValues(sampleModels, 'missing')).toEqual([]);
  });

  it('returns all models when no filters are active', () => {
    expect(filterModelsByParameters(sampleModels, {})).toHaveLength(5);
    expect(hasActiveFilters({})).toBe(false);
  });

  it('filters models by selected parameter values', () => {
    const filtered = filterModelsByParameters(sampleModels, { fast: 'true' });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.modelId).toBe('composer-2.5-fast');
  });

  it('applies AND logic across multiple dimensions', () => {
    const filtered = filterModelsByParameters(sampleModels, {
      thinking: 'true',
      context: '200k',
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.modelId).toBe('claude-4.5-sonnet');
  });

  it('excludes models without a filtered dimension', () => {
    expect(
      modelMatchesFilters(sampleModels[4]!, { fast: 'true' })
    ).toBe(false);
    expect(
      modelMatchesFilters(sampleModels[4]!, {})
    ).toBe(true);
  });

  it('formats dimension labels for display', () => {
    expect(formatDimensionLabel('reasoning')).toBe('Reasoning');
    expect(formatDimensionLabel('fast')).toBe('Fast');
  });
});
