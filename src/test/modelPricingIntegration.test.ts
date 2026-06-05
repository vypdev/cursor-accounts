import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { describe, it } from 'node:test';
import type { ModelWithPricing } from '@cursor-accounts/types';
import { getCursorStateDbPath } from '../auth/cursorPaths';
import { CursorModelPricingProvider } from '../modelEfficiency/cursorModelPricingProvider';
import { StateDbModelCatalogRepository } from '../modelEfficiency/stateDbModelCatalogRepository';
import { ModelPricingService } from '../services/modelPricingService';

describe('ModelPricing integration', () => {
  it('loads models with pricing from real state.vscdb when available', async (t) => {
    const stateDbPath = getCursorStateDbPath();
    if (!fs.existsSync(stateDbPath)) {
      t.skip('state.vscdb not available in test environment');
      return;
    }

    const service = new ModelPricingService(
      new StateDbModelCatalogRepository(),
      new CursorModelPricingProvider()
    );

    const results = await service.getModelsWithPricing(
      stateDbPath,
      process.cwd()
    );

    assert.ok(results.length > 0);

    const withPricing = results.filter(
      (model: ModelWithPricing) => model.pricing !== null
    );
    assert.ok(withPricing.length > 0);

    const withParameters = results.filter(
      (model: ModelWithPricing) =>
        model.parameters !== undefined && model.parameters.length > 0
    );
    if (withParameters.length > 0) {
      assert.ok(withParameters[0]?.parameters?.every((parameter) => parameter.id));
    }
  });
});
