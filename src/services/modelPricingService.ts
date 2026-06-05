import type { ModelCatalogEntry, ModelWithPricing } from '@cursor-accounts/types';
import type { IModelPricingProvider } from '../domain/ports/IModelPricingProvider';
import type { IModelCatalogRepository } from '../domain/ports/IModelCatalogRepository';
import {
  isModelEnabled,
  parseModelCatalog,
  parseModelToggleState,
} from '../modelEfficiency/modelConfigResolver';

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '').trim();
}

function extractVariantName(
  variantString: string | undefined
): string | undefined {
  if (!variantString) {
    return undefined;
  }

  const match = variantString.match(/\[(.+)\]/);
  return match?.[1];
}

/**
 * Application service: get all models with pricing information.
 *
 * Use case: user opens the Prices modal in the Accounts webview.
 */
export class ModelPricingService {
  constructor(
    private readonly catalogRepository: IModelCatalogRepository,
    private readonly pricingProvider: IModelPricingProvider
  ) {}

  async getModelsWithPricing(
    stateDbPath: string,
    extensionPath: string
  ): Promise<ModelWithPricing[]> {
    try {
      const catalog = await this.catalogRepository.loadModelCatalog(
        stateDbPath,
        extensionPath
      );

      if (catalog.length === 0) {
        return this.pricingProvider.getAllModelPricing().map((pricing) => ({
          baseModelId: pricing.modelId,
          displayName: pricing.displayName,
          pricing,
        }));
      }

      return this.buildFromCatalog(catalog);
    } catch (error) {
      throw new Error(
        `Failed to load model pricing: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async getEnabledModelsWithPricing(
    stateDbPath: string,
    extensionPath: string
  ): Promise<ModelWithPricing[]> {
    try {
      const raw = await this.catalogRepository.loadModelCatalogRaw(
        stateDbPath,
        extensionPath
      );
      const catalog = parseModelCatalog(raw);
      const toggles = parseModelToggleState(raw);

      if (catalog.length === 0) {
        return this.pricingProvider
          .getAllModelPricing()
          .filter((pricing) => !pricing.hiddenByDefault)
          .map((pricing) => ({
            baseModelId: pricing.modelId,
            displayName: pricing.displayName,
            pricing,
          }));
      }

      const enabledCatalog = catalog.filter((entry) =>
        isModelEnabled(entry.name, entry, toggles)
      );

      return this.buildFromCatalog(enabledCatalog);
    } catch (error) {
      throw new Error(
        `Failed to load enabled model pricing: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private buildFromCatalog(catalog: ModelCatalogEntry[]): ModelWithPricing[] {
    const results: ModelWithPricing[] = [];

    for (const entry of catalog) {
      const baseModelId = entry.name ?? entry.serverModelName ?? 'unknown';

      if (entry.variants && entry.variants.length > 0) {
        for (const variant of entry.variants) {
          const variantModelId = variant.legacySlug ?? baseModelId;
          const pricing =
            this.pricingProvider.getPricingForModel(variantModelId) ??
            this.pricingProvider.getPricingForModel(baseModelId);

          results.push({
            baseModelId,
            variantName: extractVariantName(variant.variantStringRepresentation),
            displayName: variant.displayName
              ? stripHtml(variant.displayName)
              : variantModelId,
            pricing,
            parameters: variant.parameterValues?.map((parameter) => ({
              id: parameter.id,
              value: parameter.value,
            })),
          });
        }
        continue;
      }

      results.push({
        baseModelId,
        displayName: baseModelId,
        pricing: this.pricingProvider.getPricingForModel(baseModelId),
      });
    }

    return results;
  }
}
