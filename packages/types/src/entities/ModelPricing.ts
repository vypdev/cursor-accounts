/** Model pricing catalog provenance. */
export interface ModelPricingCatalogMetadata {
  /** Immutable identifier for the manually reviewed catalog snapshot. */
  readonly version: string;
  /** Official documentation page used as the pricing source. */
  readonly sourceUrl: string;
  /** Calendar date on which the source was reviewed (ISO 8601 date). */
  readonly retrievedOn: string;
  /** Describes the intentionally bounded scope of the catalog. */
  readonly coverage: 'official-visible-models-plus-legacy-compatibility';
}

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
