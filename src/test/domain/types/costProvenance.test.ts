import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mergeCostProvenance,
  normalizeCostSource,
} from '../../../domain/types/costProvenance';

describe('cost provenance', () => {
  it('normalizes unknown persistence values safely', () => {
    assert.equal(normalizeCostSource('model_pricing'), 'model_pricing');
    assert.equal(normalizeCostSource('unexpected'), 'unknown');
    assert.equal(normalizeCostSource(undefined), 'unknown');
  });

  it('does not let unknown legacy evidence erase stronger evidence', () => {
    assert.deepEqual(
      mergeCostProvenance(
        { source: 'model_pricing', pricingSnapshotVersion: 'catalog-1' },
        { source: 'unknown' }
      ),
      { source: 'model_pricing', pricingSnapshotVersion: 'catalog-1' }
    );
  });

  it('marks mixed evidence without selecting a false snapshot', () => {
    assert.deepEqual(
      mergeCostProvenance(
        { source: 'model_pricing', pricingSnapshotVersion: 'catalog-1' },
        { source: 'model_pricing', pricingSnapshotVersion: 'catalog-2' }
      ),
      { source: 'mixed' }
    );
    assert.deepEqual(
      mergeCostProvenance(
        { source: 'provided' },
        { source: 'server' }
      ),
      { source: 'mixed' }
    );
  });
});
