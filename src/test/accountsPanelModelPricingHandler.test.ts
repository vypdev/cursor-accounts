import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ModelWithPricing, ToWebviewMessage } from '@cursor-accounts/types';
import {
  AccountsPanelModelPricingHandler,
  toModelPricingDisplayData,
} from '../ui/accountsPanelModelPricingHandler';

const PRICING = {
  modelId: 'claude-sonnet-4-5',
  displayName: 'Claude Sonnet 4.5',
  provider: 'Anthropic' as const,
  inputPer1M: 3,
  outputPer1M: 15,
  cacheReadPer1M: 0.3,
  cacheWritePer1M: 3.75,
  notes: 'Reviewed pricing',
  hiddenByDefault: false,
};

describe('AccountsPanelModelPricingHandler', () => {
  it('maps priced models and preserves variant parameters', () => {
    const models: ModelWithPricing[] = [
      {
        baseModelId: 'claude-sonnet-4-5',
        variantName: 'Max Mode',
        displayName: 'Claude Sonnet 4.5 [Max Mode]',
        pricing: PRICING,
        parameters: [{ id: 'thinking', value: 'enabled' }],
      },
      {
        baseModelId: 'unknown',
        displayName: 'Unknown',
        pricing: null,
      },
    ];

    assert.deepEqual(toModelPricingDisplayData(models), [
      {
        modelId: 'claude-sonnet-4-5',
        displayName: 'Claude Sonnet 4.5 [Max Mode]',
        provider: 'Anthropic',
        inputPer1M: 3,
        outputPer1M: 15,
        cacheReadPer1M: 0.3,
        cacheWritePer1M: 3.75,
        notes: 'Reviewed pricing',
        variantName: 'Max Mode',
        parameters: [{ id: 'thinking', value: 'enabled' }],
      },
    ]);
  });

  it('loads all and enabled pricing concurrently and posts one response', async () => {
    const calls: string[] = [];
    const posted: ToWebviewMessage[] = [];
    const handler = new AccountsPanelModelPricingHandler(
      {
        profileDetector: {
          getCurrentUserDataDir: () => '/tmp/cursor-profile',
        },
        modelPricingReader: {
          getModelsWithPricing: async (stateDbPath, extensionPath) => {
            calls.push(`all:${stateDbPath}:${extensionPath}`);
            return [
              {
                baseModelId: 'all',
                displayName: 'All',
                pricing: PRICING,
              },
            ];
          },
          getEnabledModelsWithPricing: async (stateDbPath, extensionPath) => {
            calls.push(`enabled:${stateDbPath}:${extensionPath}`);
            return [];
          },
        },
        extensionPath: '/tmp/extension',
      },
      {
        postMessage: async (message) => {
          posted.push(message);
        },
      }
    );

    await handler.handle();

    assert.deepEqual(calls.sort(), [
      'all:/tmp/cursor-profile/User/globalStorage/state.vscdb:/tmp/extension',
      'enabled:/tmp/cursor-profile/User/globalStorage/state.vscdb:/tmp/extension',
    ]);
    assert.deepEqual(posted, [
      {
        type: 'modelPricing',
        data: [
          {
            modelId: 'claude-sonnet-4-5',
            displayName: 'All',
            provider: 'Anthropic',
            inputPer1M: 3,
            outputPer1M: 15,
            cacheReadPer1M: 0.3,
            cacheWritePer1M: 3.75,
            notes: 'Reviewed pricing',
            variantName: undefined,
            parameters: undefined,
          },
        ],
        enabledModels: [],
      },
    ]);
  });

  it('posts a stable error message when pricing loading fails', async () => {
    const posted: ToWebviewMessage[] = [];
    const handler = new AccountsPanelModelPricingHandler(
      {
        profileDetector: {
          getCurrentUserDataDir: () => '/tmp/cursor-profile',
        },
        modelPricingReader: {
          getModelsWithPricing: async () => {
            throw new Error('catalog unavailable');
          },
          getEnabledModelsWithPricing: async () => [],
        },
        extensionPath: '/tmp/extension',
      },
      {
        postMessage: async (message) => {
          posted.push(message);
        },
      }
    );

    await handler.handle();

    assert.deepEqual(posted, [
      { type: 'modelPricingError', error: 'catalog unavailable' },
    ]);
  });
});
