import type {
  ModelPricingDisplayData,
  ModelWithPricing,
  ToWebviewMessage,
} from '@cursor-accounts/types';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import { getProfileStateDbPath } from '../auth/cursorPaths';

export interface AccountsPanelModelPricingReader {
  getModelsWithPricing(
    stateDbPath: string,
    extensionPath: string
  ): Promise<ModelWithPricing[]>;
  getEnabledModelsWithPricing(
    stateDbPath: string,
    extensionPath: string
  ): Promise<ModelWithPricing[]>;
}

export interface AccountsPanelModelPricingDependencies {
  profileDetector: Pick<IProfileDetector, 'getCurrentUserDataDir'>;
  modelPricingReader: AccountsPanelModelPricingReader;
  extensionPath: string;
}

export interface AccountsPanelModelPricingCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
}

/** Maps the application pricing model into the webview's transport shape. */
export function toModelPricingDisplayData(
  models: ModelWithPricing[]
): ModelPricingDisplayData[] {
  return models.flatMap((model) => {
    if (model.pricing === null) {
      return [];
    }

    const pricing = model.pricing;
    return [
      {
        modelId: pricing.modelId,
        displayName: model.displayName,
        provider: pricing.provider,
        inputPer1M: pricing.inputPer1M,
        outputPer1M: pricing.outputPer1M,
        cacheReadPer1M: pricing.cacheReadPer1M,
        cacheWritePer1M: pricing.cacheWritePer1M,
        notes: pricing.notes,
        variantName: model.variantName,
        parameters: model.parameters?.map((parameter) => ({
          id: parameter.id,
          value: parameter.value,
        })),
      },
    ];
  });
}

/** Handles the model-pricing request without owning panel lifecycle or routing. */
export class AccountsPanelModelPricingHandler {
  constructor(
    private readonly dependencies: AccountsPanelModelPricingDependencies,
    private readonly callbacks: AccountsPanelModelPricingCallbacks
  ) {}

  async handle(): Promise<void> {
    try {
      const userDataDir =
        this.dependencies.profileDetector.getCurrentUserDataDir();
      const stateDbPath = getProfileStateDbPath(userDataDir);
      const [allModels, enabledModels] = await Promise.all([
        this.dependencies.modelPricingReader.getModelsWithPricing(
          stateDbPath,
          this.dependencies.extensionPath
        ),
        this.dependencies.modelPricingReader.getEnabledModelsWithPricing(
          stateDbPath,
          this.dependencies.extensionPath
        ),
      ]);

      await this.callbacks.postMessage({
        type: 'modelPricing',
        data: toModelPricingDisplayData(allModels),
        enabledModels: toModelPricingDisplayData(enabledModels),
      });
    } catch (error) {
      await this.callbacks.postMessage({
        type: 'modelPricingError',
        error:
          error instanceof Error ? error.message : 'Failed to load model pricing',
      });
    }
  }
}
