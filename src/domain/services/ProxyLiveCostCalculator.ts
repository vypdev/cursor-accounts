import type { IModelPricingProvider } from '../ports/IModelPricingProvider';
import type {
  CostEstimate,
  IProxyLiveCostCalculator,
  TurnTokenBreakdown,
} from '../ports/IProxyLiveCostCalculator';
import { normalizeTokenCount, roundCostCents } from './tokenAccounting';

const DEFAULT_FALLBACK_DOLLARS_PER_M = 4;

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

  estimateDeltaCost(
    deltaTokens: number,
    modelId: string | undefined
  ): CostEstimate {
    const normalizedDelta = normalizeTokenCount(deltaTokens);
    const pricing = modelId
      ? this.pricingProvider.getPricingForModel(modelId)
      : null;

    if (!pricing) {
      return {
        costCents: this.tokensToCents(
          normalizedDelta,
          normalizeRate(this.getFallbackDollarsPerM())
        ),
        source: 'fallback',
      };
    }

    return {
      costCents: this.tokensToCents(
        normalizedDelta,
        (pricing.inputPer1M + pricing.outputPer1M) / 2
      ),
      source: 'model_pricing',
      pricingSnapshotVersion: this.pricingProvider.getCatalogMetadata().version,
    };
  }

  calculateDeltaCost(
    deltaTokens: number,
    modelId: string | undefined
  ): number {
    return this.estimateDeltaCost(deltaTokens, modelId).costCents;
  }

  estimateTurnCost(
    breakdown: TurnTokenBreakdown,
    modelId: string | undefined
  ): CostEstimate {
    const inputTokens = normalizeTokenCount(breakdown.inputTokens);
    const outputTokens = normalizeTokenCount(breakdown.outputTokens);
    const cacheReadTokens = normalizeTokenCount(breakdown.cacheReadTokens);
    const cacheWriteTokens = normalizeTokenCount(breakdown.cacheWriteTokens);
    const pricing = modelId
      ? this.pricingProvider.getPricingForModel(modelId)
      : null;

    const totalTokens =
      inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

    if (!pricing) {
      return {
        costCents: this.tokensToCents(
          totalTokens,
          this.getFallbackDollarsPerM()
        ),
        source: 'fallback',
      };
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

    return {
      costCents: roundCostCents(costCents),
      source: 'model_pricing',
      pricingSnapshotVersion: this.pricingProvider.getCatalogMetadata().version,
    };
  }

  calculateTurnCost(
    breakdown: TurnTokenBreakdown,
    modelId: string | undefined
  ): number {
    return this.estimateTurnCost(breakdown, modelId).costCents;
  }

  private tokensToCents(tokens: number, dollarsPerMillion: number): number {
    const normalizedTokens = normalizeTokenCount(tokens);
    const normalizedRate = normalizeRate(dollarsPerMillion);
    if (normalizedTokens === 0 || normalizedRate === 0) {
      return 0;
    }
    return roundCostCents(
      (normalizedTokens / 1_000_000) * normalizedRate * 100
    );
  }
}
