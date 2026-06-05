export interface TurnTokenBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * Calculates live proxy token costs using per-model pricing rates.
 */
export interface IProxyLiveCostCalculator {
  /**
   * Cost of a streaming token_delta (blended input/output rate).
   * @returns Cost in USD cents.
   */
  calculateDeltaCost(
    deltaTokens: number,
    modelId: string | undefined
  ): number;

  /**
   * Cost of a completed turn with input/output/cache breakdown.
   * @returns Cost in USD cents.
   */
  calculateTurnCost(
    breakdown: TurnTokenBreakdown,
    modelId: string | undefined
  ): number;
}
