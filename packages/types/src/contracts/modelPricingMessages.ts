/** Variant parameter exposed to the pricing modal for filtering. */
export interface ModelPricingParameter {
  readonly id: string;
  readonly value: string;
}

/** Webview row for the model pricing modal. */
export interface ModelPricingDisplayData {
  readonly modelId: string;
  readonly displayName: string;
  readonly provider: string;
  readonly inputPer1M: number;
  readonly outputPer1M: number;
  readonly cacheReadPer1M?: number;
  readonly cacheWritePer1M?: number;
  readonly notes?: string;
  readonly variantName?: string;
  readonly parameters?: readonly ModelPricingParameter[];
}

export interface RequestModelPricingMessage {
  type: 'requestModelPricing';
}

export interface ModelPricingResponseMessage {
  type: 'modelPricing';
  data: ModelPricingDisplayData[];
  enabledModels?: ModelPricingDisplayData[];
}

export interface ModelPricingErrorMessage {
  type: 'modelPricingError';
  error: string;
}
