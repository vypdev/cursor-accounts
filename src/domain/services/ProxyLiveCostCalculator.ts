import type { IModelPricingProvider } from '../ports/IModelPricingProvider';
import type {
  IProxyLiveCostCalculator,
  TurnTokenBreakdown,
} from '../ports/IProxyLiveCostCalculator';

const DEFAULT_FALLBACK_DOLLARS_PER_M = 4;

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
    if (deltaTokens <= 0) {
      return 0;
    }

    const pricing = modelId
      ? this.pricingProvider.getPricingForModel(modelId)
      : null;

    if (!pricing) {
      return this.tokensToCents(deltaTokens, this.getFallbackDollarsPerM());
    }

    const blendedRatePer1M =
      (pricing.inputPer1M + pricing.outputPer1M) / 2;
    return this.tokensToCents(deltaTokens, blendedRatePer1M);
  }

  calculateTurnCost(
    breakdown: TurnTokenBreakdown,
    modelId: string | undefined
  ): number {
    const pricing = modelId
      ? this.pricingProvider.getPricingForModel(modelId)
      : null;

    const totalTokens =
      breakdown.inputTokens +
      breakdown.outputTokens +
      (breakdown.cacheReadTokens ?? 0) +
      (breakdown.cacheWriteTokens ?? 0);

    if (totalTokens <= 0) {
      return 0;
    }

    if (!pricing) {
      return this.tokensToCents(totalTokens, this.getFallbackDollarsPerM());
    }

    let costCents = 0;

    costCents += this.tokensToCents(breakdown.inputTokens, pricing.inputPer1M);
    costCents += this.tokensToCents(
      breakdown.outputTokens,
      pricing.outputPer1M
    );

    if (breakdown.cacheReadTokens && pricing.cacheReadPer1M != null) {
      costCents += this.tokensToCents(
        breakdown.cacheReadTokens,
        pricing.cacheReadPer1M
      );
    }

    if (breakdown.cacheWriteTokens && pricing.cacheWritePer1M != null) {
      costCents += this.tokensToCents(
        breakdown.cacheWriteTokens,
        pricing.cacheWritePer1M
      );
    }

    return costCents;
  }

  private tokensToCents(tokens: number, dollarsPerMillion: number): number {
    if (tokens <= 0 || dollarsPerMillion <= 0) {
      return 0;
    }
    return (tokens / 1_000_000) * dollarsPerMillion * 100;
  }
}
