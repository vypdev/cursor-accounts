/**
 * Model pricing information entity.
 * Source: https://cursor.com/docs/models-and-pricing
 * Last updated: 2026-06-05
 */

export type ModelPricingProvider =
  | 'Cursor'
  | 'Anthropic'
  | 'OpenAI'
  | 'Google'
  | 'xAI'
  | 'Moonshot'
  | 'Unknown';

/** Per-model API pricing (USD per 1M tokens). */
export interface ModelPricing {
  /** Unique model identifier (e.g. "claude-sonnet-4-5", "composer-2.5-fast"). */
  readonly modelId: string;
  /** Human-readable display name. */
  readonly displayName: string;
  /** Model provider. */
  readonly provider: ModelPricingProvider;
  /** Input token cost per 1M tokens (USD). */
  readonly inputPer1M: number;
  /** Output token cost per 1M tokens (USD). */
  readonly outputPer1M: number;
  /** Cache read cost per 1M tokens (USD), if supported. */
  readonly cacheReadPer1M?: number;
  /** Cache write cost per 1M tokens (USD), if supported. */
  readonly cacheWritePer1M?: number;
  /** Additional notes (e.g. "Hidden by default", "Requires Max Mode"). */
  readonly notes?: string;
  /** Whether this model is hidden by default in Cursor UI. */
  readonly hiddenByDefault: boolean;
}

/** Variant parameter from Cursor model catalog. */
export interface ModelVariantParameter {
  readonly id: string;
  readonly value: string;
}

/** Model catalog entry with optional variant pricing match. */
export interface ModelWithPricing {
  readonly baseModelId: string;
  readonly variantName?: string;
  readonly displayName: string;
  readonly pricing: ModelPricing | null;
  readonly parameters?: readonly ModelVariantParameter[];
}
