import type {
  ModelPricing,
  ModelPricingCatalogMetadata,
  ModelPricingProvider,
} from '@cursor-accounts/types';
import type { IModelPricingProvider } from '../domain/ports/IModelPricingProvider';

export const CURSOR_MODEL_PRICING_SOURCE_URL =
  'https://cursor.com/docs/models-and-pricing';
export const CURSOR_MODEL_PRICING_CATALOG_VERSION = 'cursor-docs-2026-08-26';
export const CURSOR_MODEL_PRICING_RETRIEVED_ON = '2026-08-26';

export const CURSOR_MODEL_PRICING_CATALOG_METADATA: ModelPricingCatalogMetadata =
  Object.freeze({
    version: CURSOR_MODEL_PRICING_CATALOG_VERSION,
    sourceUrl: CURSOR_MODEL_PRICING_SOURCE_URL,
    retrievedOn: CURSOR_MODEL_PRICING_RETRIEVED_ON,
    coverage: 'official-visible-models-plus-legacy-compatibility',
  });

const CURRENT_CATALOG_NOTE =
  'Verified against the official Cursor pricing table on 2026-08-26.';

/**
 * Hardcoded Cursor model pricing from the reviewed official documentation
 * snapshot.
 *
 * The catalog deliberately contains both currently verified entries and
 * legacy compatibility entries. The metadata above identifies the source
 * snapshot; it does not imply that every legacy entry is still offered.
 */

type PricingSeed = Omit<ModelPricing, 'modelId'> & {
  modelIds: string[];
};

function roundPrice(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function anthropic(
  displayName: string,
  inputPer1M: number,
  outputPer1M: number,
  options: {
    modelIds: string[];
    cacheReadPer1M?: number;
    cacheWritePer1M?: number;
    hiddenByDefault?: boolean;
    notes?: string;
  }
): PricingSeed {
  return {
    modelIds: options.modelIds,
    displayName,
    provider: 'Anthropic',
    inputPer1M,
    outputPer1M,
    cacheReadPer1M: roundPrice(
      options.cacheReadPer1M ?? inputPer1M * 0.1,
      3
    ),
    cacheWritePer1M: roundPrice(
      options.cacheWritePer1M ?? inputPer1M * 1.25,
      3
    ),
    hiddenByDefault: options.hiddenByDefault ?? true,
    notes: options.notes,
  };
}

function openAi(
  displayName: string,
  inputPer1M: number,
  outputPer1M: number,
  options: {
    modelIds: string[];
    cacheReadPer1M?: number;
    cacheWritePer1M?: number;
    hiddenByDefault?: boolean;
    notes?: string;
  }
): PricingSeed {
  return {
    modelIds: options.modelIds,
    displayName,
    provider: 'OpenAI',
    inputPer1M,
    outputPer1M,
    cacheReadPer1M: roundPrice(
      options.cacheReadPer1M ?? inputPer1M * 0.1,
      3
    ),
    cacheWritePer1M: options.cacheWritePer1M,
    hiddenByDefault: options.hiddenByDefault ?? true,
    notes: options.notes,
  };
}

function google(
  displayName: string,
  inputPer1M: number,
  outputPer1M: number,
  options: {
    modelIds: string[];
    cacheReadPer1M?: number;
    hiddenByDefault?: boolean;
    notes?: string;
  }
): PricingSeed {
  return {
    modelIds: options.modelIds,
    displayName,
    provider: 'Google',
    inputPer1M,
    outputPer1M,
    cacheReadPer1M: roundPrice(
      options.cacheReadPer1M ?? inputPer1M * 0.1,
      3
    ),
    hiddenByDefault: options.hiddenByDefault ?? true,
    notes: options.notes,
  };
}

function cursorModel(
  displayName: string,
  inputPer1M: number,
  outputPer1M: number,
  options: {
    modelIds: string[];
    cacheReadPer1M?: number;
    hiddenByDefault?: boolean;
    notes?: string;
  }
): PricingSeed {
  return {
    modelIds: options.modelIds,
    displayName,
    provider: 'Cursor',
    inputPer1M,
    outputPer1M,
    cacheReadPer1M: options.cacheReadPer1M,
    hiddenByDefault: options.hiddenByDefault ?? true,
    notes: options.notes,
  };
}

const PRICING_SEEDS: readonly PricingSeed[] = [
  {
    modelIds: ['legacy-enterprise-auto', 'enterprise-auto-legacy'],
    displayName: 'Legacy Enterprise Auto',
    provider: 'Cursor',
    inputPer1M: 1.25,
    outputPer1M: 6,
    cacheReadPer1M: 0.25,
    cacheWritePer1M: 1.25,
    hiddenByDefault: true,
    notes:
      'Fixed legacy Enterprise Auto pricing is documented through 2026-09-07; normal Auto requests use the routed model rate.',
  },
  cursorModel('Grok 4.6', 2, 6, {
    modelIds: ['grok-4.6'],
    cacheReadPer1M: 0.5,
    hiddenByDefault: false,
    notes: CURRENT_CATALOG_NOTE,
  }),
  cursorModel('Grok 4.6 (Fast)', 4, 12, {
    modelIds: ['grok-4.6-fast'],
    cacheReadPer1M: 1,
    hiddenByDefault: false,
    notes: CURRENT_CATALOG_NOTE,
  }),
  cursorModel('Grok 4.5', 2, 6, {
    modelIds: ['grok-4.5'],
    cacheReadPer1M: 0.5,
    hiddenByDefault: false,
    notes: CURRENT_CATALOG_NOTE,
  }),
  cursorModel('Grok 4.5 (Fast)', 4, 18, {
    modelIds: ['grok-4.5-fast'],
    cacheReadPer1M: 1,
    hiddenByDefault: false,
    notes: CURRENT_CATALOG_NOTE,
  }),
  cursorModel('Composer 1', 1.25, 10, {
    modelIds: ['composer-1'],
    cacheReadPer1M: 0.125,
  }),
  cursorModel('Composer 1.5', 3.5, 17.5, {
    modelIds: ['composer-1.5'],
    cacheReadPer1M: 0.35,
  }),
  cursorModel('Composer 2', 0.5, 2.5, {
    modelIds: ['composer-2'],
    cacheReadPer1M: 0.2,
  }),
  cursorModel('Composer 2.5', 0.5, 2.5, {
    modelIds: ['composer-2.5'],
    cacheReadPer1M: 0.2,
    hiddenByDefault: false,
    notes: CURRENT_CATALOG_NOTE,
  }),
  cursorModel('Composer 2.5 (Fast)', 3, 15, {
    modelIds: ['composer-2.5-fast'],
    cacheReadPer1M: 0.5,
    hiddenByDefault: false,
    notes: CURRENT_CATALOG_NOTE,
  }),
  anthropic('Claude Fable 5', 10, 50, {
    modelIds: ['claude-fable-5'],
    hiddenByDefault: false,
    notes: CURRENT_CATALOG_NOTE,
  }),
  anthropic('Claude Opus 5', 5, 25, {
    modelIds: ['claude-opus-5'],
    hiddenByDefault: false,
    notes: CURRENT_CATALOG_NOTE,
  }),
  anthropic('Claude Sonnet 5', 2, 10, {
    modelIds: ['claude-sonnet-5'],
    hiddenByDefault: false,
    notes: CURRENT_CATALOG_NOTE,
  }),
  google('Gemini 3.7 Flash', 0.75, 3.5, {
    modelIds: ['gemini-3.7-flash'],
    hiddenByDefault: false,
    notes: CURRENT_CATALOG_NOTE,
  }),
  openAi('GPT-5.6 Luna', 0.2, 1.2, {
    modelIds: ['gpt-5.6-luna'],
    cacheReadPer1M: 0.02,
    cacheWritePer1M: 0.25,
    hiddenByDefault: false,
    notes: CURRENT_CATALOG_NOTE,
  }),
  openAi('GPT-5.6 Sol', 4, 20, {
    modelIds: ['gpt-5.6-sol'],
    cacheReadPer1M: 0.4,
    cacheWritePer1M: 5,
    hiddenByDefault: false,
    notes: CURRENT_CATALOG_NOTE,
  }),
  openAi('GPT-5.6 Terra', 2, 12, {
    modelIds: ['gpt-5.6-terra'],
    cacheReadPer1M: 0.2,
    cacheWritePer1M: 2.5,
    hiddenByDefault: false,
    notes: CURRENT_CATALOG_NOTE,
  }),
  anthropic('Claude 4 Sonnet', 3, 15, {
    modelIds: ['claude-4-sonnet', 'claude-sonnet-4'],
    notes: 'Thinking variant counts as 2 requests in legacy pricing',
  }),
  anthropic('Claude 4 Sonnet 1M', 6, 22.5, {
    modelIds: ['claude-4-sonnet-1m', 'claude-sonnet-4-1m'],
    notes:
      'Large context; 2x input when input exceeds 200k tokens in long-context mode',
  }),
  anthropic('Claude 4.5 Haiku', 1, 5, {
    modelIds: ['claude-4.5-haiku', 'claude-haiku-4-5'],
  }),
  anthropic('Claude 4.5 Opus', 5, 25, {
    modelIds: ['claude-4.5-opus', 'claude-opus-4-5'],
    notes: 'Requires Max Mode on request-based plans',
  }),
  anthropic('Claude 4.5 Sonnet', 3, 15, {
    modelIds: [
      'claude-4.5-sonnet',
      'claude-sonnet-4-5',
      'claude-4.5-sonnet-thinking',
    ],
    notes: 'Requires Max Mode on request-based plans',
  }),
  anthropic('Claude 4.6 Opus', 5, 25, {
    modelIds: ['claude-4.6-opus', 'claude-opus-4-6'],
    notes: 'Requires Max Mode on request-based plans',
  }),
  anthropic('Claude 4.6 Opus (Fast mode)', 30, 150, {
    modelIds: ['claude-4.6-opus-fast', 'claude-opus-4-6-fast'],
    notes: 'Limited research preview; Requires Max Mode',
  }),
  anthropic('Claude 4.6 Sonnet', 3, 15, {
    modelIds: ['claude-4.6-sonnet', 'claude-sonnet-4-6'],
    hiddenByDefault: false,
    notes: 'Requires Max Mode on request-based plans',
  }),
  anthropic('Claude 4.7 Opus', 5, 25, {
    modelIds: ['claude-4.7-opus', 'claude-opus-4-7'],
    notes: 'Requires Max Mode on request-based plans',
  }),
  anthropic('Claude Opus 4.7 (fast mode)', 30, 150, {
    modelIds: ['claude-opus-4-7-fast', 'claude-4.7-opus-fast'],
    notes: 'Limited research preview; Requires Max Mode',
  }),
  anthropic('Claude Opus 4.8', 5, 25, {
    modelIds: ['claude-opus-4-8', 'claude-4.8-opus', 'claude-opus-4-8-fast'],
    hiddenByDefault: false,
    notes:
      'Fast mode requires Max Mode; Fast mode is 3x lower per-token than Opus 4.7 fast',
  }),
  openAi('GPT-5', 1.25, 10, {
    modelIds: ['gpt-5', 'gpt-5-high'],
    notes: 'Agentic and reasoning capabilities',
  }),
  openAi('GPT-5 Fast', 2.5, 20, {
    modelIds: ['gpt-5-fast', 'gpt-5-high-fast', 'gpt-5-low-fast'],
    notes: 'Faster speed but 2x price',
  }),
  openAi('GPT-5 Mini', 0.25, 2, {
    modelIds: ['gpt-5-mini'],
  }),
  openAi('GPT-5-Codex', 1.25, 10, {
    modelIds: ['gpt-5-codex'],
    notes: 'Agentic and reasoning capabilities',
  }),
  openAi('GPT-5.1 Codex', 1.25, 10, {
    modelIds: ['gpt-5.1-codex'],
    notes: 'Agentic and reasoning capabilities',
  }),
  openAi('GPT-5.1 Codex Max', 1.25, 10, {
    modelIds: ['gpt-5.1-codex-max'],
  }),
  openAi('GPT-5.1 Codex Mini', 0.25, 2, {
    modelIds: ['gpt-5.1-codex-mini'],
    notes: '4x rate limits compared to GPT-5.1 Codex',
  }),
  openAi('GPT-5.2', 1.75, 14, {
    modelIds: ['gpt-5.2', 'gpt-5.2-high'],
    notes: 'Agentic and reasoning capabilities',
  }),
  openAi('GPT-5.2 Codex', 1.75, 14, {
    modelIds: ['gpt-5.2-codex'],
    notes: 'Agentic and reasoning capabilities',
  }),
  openAi('GPT-5.3 Codex', 1.75, 14, {
    modelIds: ['gpt-5.3-codex', 'gpt-5.3-codex-high'],
    hiddenByDefault: false,
    notes: 'Requires Max Mode on request-based plans',
  }),
  openAi('GPT-5.4', 2.5, 15, {
    modelIds: ['gpt-5.4'],
    notes:
      'Requires Max Mode; 90% discount on cached input; Fast mode is 2x pricing',
  }),
  openAi('GPT-5.4 Mini', 0.75, 4.5, {
    modelIds: ['gpt-5.4-mini'],
    notes: '90% discount on cached input tokens',
  }),
  openAi('GPT-5.4 Nano', 0.2, 1.25, {
    modelIds: ['gpt-5.4-nano'],
    notes: '90% discount on cached input tokens',
  }),
  openAi('GPT-5.5', 5, 30, {
    modelIds: ['gpt-5.5'],
    hiddenByDefault: false,
    notes: 'Requires Max Mode; Long context supports up to 1M tokens',
  }),
  google('Gemini 2.5 Flash', 0.3, 2.5, {
    modelIds: ['gemini-2.5-flash'],
  }),
  google('Gemini 3 Flash', 0.5, 3, {
    modelIds: ['gemini-3-flash'],
  }),
  google('Gemini 3 Pro', 2, 12, {
    modelIds: ['gemini-3-pro'],
  }),
  google('Gemini 3 Pro Image Preview', 2, 12, {
    modelIds: ['gemini-3-pro-image-preview'],
    notes: 'Image output priced separately at $120/1M tokens',
  }),
  google('Gemini 3.1 Pro', 2, 12, {
    modelIds: ['gemini-3.1-pro'],
    hiddenByDefault: false,
  }),
  google('Gemini 3.5 Flash', 1.5, 9, {
    modelIds: ['gemini-3.5-flash'],
    hiddenByDefault: false,
  }),
  {
    modelIds: ['grok-4.20'],
    displayName: 'Grok 4.20',
    provider: 'xAI',
    inputPer1M: 2,
    outputPer1M: 6,
    cacheReadPer1M: 0.2,
    hiddenByDefault: true,
    notes: '2x cost when input exceeds 200k tokens',
  },
  {
    modelIds: ['grok-4.3'],
    displayName: 'Grok 4.3',
    provider: 'xAI',
    inputPer1M: 1.25,
    outputPer1M: 2.5,
    cacheReadPer1M: 0.2,
    hiddenByDefault: true,
    notes: 'Requires Max Mode on request-based plans',
  },
  {
    modelIds: ['grok-build-0.1'],
    displayName: 'Grok Build 0.1',
    provider: 'xAI',
    inputPer1M: 1,
    outputPer1M: 2,
    cacheReadPer1M: 0.2,
    hiddenByDefault: false,
    notes: '2x cost when input exceeds 200k tokens',
  },
  {
    modelIds: ['kimi-k2.5'],
    displayName: 'Kimi K2.5',
    provider: 'Moonshot',
    inputPer1M: 0.6,
    outputPer1M: 3,
    cacheReadPer1M: 0.1,
    hiddenByDefault: true,
  },
];

function expandPricingSeeds(seeds: readonly PricingSeed[]): ModelPricing[] {
  const entries: ModelPricing[] = [];

  for (const seed of seeds) {
    const { modelIds, ...rest } = seed;
    for (const modelId of modelIds) {
      entries.push({
        modelId,
        ...rest,
      });
    }
  }

  return entries;
}

const CURSOR_MODEL_PRICING = expandPricingSeeds(PRICING_SEEDS);

const PRICING_MAP = new Map<string, ModelPricing>(
  CURSOR_MODEL_PRICING.map((pricing) => [pricing.modelId, pricing])
);

/** Normalize catalog slugs for lookup (lowercase, strip variant suffix noise). */
export function normalizePricingModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

export class CursorModelPricingProvider implements IModelPricingProvider {
  getCatalogMetadata(): ModelPricingCatalogMetadata {
    return CURSOR_MODEL_PRICING_CATALOG_METADATA;
  }

  getPricingForModel(modelId: string): ModelPricing | null {
    const normalized = normalizePricingModelId(modelId);
    return PRICING_MAP.get(normalized) ?? null;
  }

  getAllModelPricing(): ModelPricing[] {
    const seen = new Set<string>();
    const unique: ModelPricing[] = [];

    for (const pricing of CURSOR_MODEL_PRICING) {
      const key = [
        pricing.provider,
        pricing.displayName,
        pricing.inputPer1M,
        pricing.outputPer1M,
        pricing.cacheReadPer1M ?? '',
        pricing.cacheWritePer1M ?? '',
      ].join(':');
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(pricing);
    }

    return unique.sort((left, right) => {
      const providerOrder = compareProviders(left.provider, right.provider);
      if (providerOrder !== 0) {
        return providerOrder;
      }
      return left.displayName.localeCompare(right.displayName);
    });
  }
}

function compareProviders(
  left: ModelPricingProvider,
  right: ModelPricingProvider
): number {
  const order: ModelPricingProvider[] = [
    'Cursor',
    'Anthropic',
    'OpenAI',
    'Google',
    'xAI',
    'Moonshot',
    'Unknown',
  ];
  return order.indexOf(left) - order.indexOf(right);
}
