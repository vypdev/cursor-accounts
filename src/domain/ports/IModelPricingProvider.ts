import type { ModelPricing } from '@cursor-accounts/types';

/**
 * Port for accessing model pricing information.
 *
 * Implementations may source data from:
 * - Hardcoded constants (current: official documentation)
 * - HTTP API (future: if Cursor exposes pricing endpoint)
 * - Configuration file (future: user-defined pricing overrides)
 */
export interface IModelPricingProvider {
  /**
   * Get pricing for a specific model by ID or legacy slug.
   * @param modelId Model identifier (e.g. "claude-sonnet-4-5")
   * @returns Pricing data or null if unavailable
   */
  getPricingForModel(modelId: string): ModelPricing | null;

  /**
   * Get pricing for all known models.
   * @returns Array of all model pricing data
   */
  getAllModelPricing(): ModelPricing[];
}
