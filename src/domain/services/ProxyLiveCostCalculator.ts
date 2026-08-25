import type { IModelPricingProvider } from '../ports/IModelPricingProvider';
import type {
  IProxyLiveCostCalculator,
  TurnTokenBreakdown,
} from '../ports/IProxyLiveCostCalculator';

const DEFAULT_FALLBACK_DOLLARS_PER_M = 4;

function normalizeTokenCount(value: number | undefined): number {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
}

function normalizeRate(value: number | undefined): number {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
}

export class ProxyLiveCostCalculator implements IProxyLiveCostCalculator {
  constructor(
    private readonly pricingProvider: IModelPricingProvider,
    private readonly getFallbackDollarsPerM: () => number = () =>
      DEFAULT_FALLBACK_DOLLARS_PER_M
  ) {}

  calculateDeltaCost(
    deltaTokens: number,
    modelId: string | undefined
  ): number {
    const normalizedDelta = normalizeTokenCount(deltaTokens);
    if (normalizedDelta === 0) {
      return 0;
    }

    const pricing = modelId
      ? this.pricingProvider.getPricingForModel(modelId)
      : null;

    if (!pricing) {
      return this.tokensToCents(
        normalizedDelta,
        normalizeRate(this.getFallbackDollarsPerM())
      );
    }

    const blendedRatePer1M =
      (pricing.inputPer1M + pricing.outputPer1M) / 2;
    return this.tokensToCents(normalizedDelta, blendedRatePer1M);
  }

  calculateTurnCost(
    breakdown: TurnTokenBreakdown,
    modelId: string | undefined
  ): number {
    const inputTokens = normalizeTokenCount(breakdown.inputTokens);
    const outputTokens = normalizeTokenCount(breakdown.outputTokens);
    const cacheReadTokens = normalizeTokenCount(breakdown.cacheReadTokens);
    const cacheWriteTokens = normalizeTokenCount(breakdown.cacheWriteTokens);
    const pricing = modelId
      ? this.pricingProvider.getPricingForModel(modelId)
      : null;

    const totalTokens =
      inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

    if (totalTokens <= 0) {
      return 0;
    }

    if (!pricing) {
      return this.tokensToCents(totalTokens, this.getFallbackDollarsPerM());
    }

    let costCents = 0;

    costCents += this.tokensToCents(inputTokens, pricing.inputPer1M);
    costCents += this.tokensToCents(outputTokens, pricing.outputPer1M);

    if (cacheReadTokens > 0 && pricing.cacheReadPer1M != null) {
      costCents += this.tokensToCents(
        cacheReadTokens,
        pricing.cacheReadPer1M
      );
    }

    if (cacheWriteTokens > 0 && pricing.cacheWritePer1M != null) {
      costCents += this.tokensToCents(
        cacheWriteTokens,
        pricing.cacheWritePer1M
      );
    }

    return costCents;
  }

  private tokensToCents(tokens: number, dollarsPerMillion: number): number {
    const normalizedTokens = normalizeTokenCount(tokens);
    const normalizedRate = normalizeRate(dollarsPerMillion);
    if (normalizedTokens === 0 || normalizedRate === 0) {
      return 0;
    }
    return (normalizedTokens / 1_000_000) * normalizedRate * 100;
  }
}
