import { useMemo, useState } from 'react';
import type { ModelPricingDisplayData } from '../types';
import { ModelVariantBadges } from './ModelVariantBadge';
import { PricesFilterPill } from './PricesFilterPill';
import {
  extractParameterDimensions,
  extractParameterValues,
  filterModelsByParameters,
  type FilterState,
} from './pricesModalFilters';

interface PricesModalProps {
  models: ModelPricingDisplayData[];
  enabledModels?: ModelPricingDisplayData[];
  loading?: boolean;
  onClose: () => void;
}

function formatPrice(value: number | undefined, decimals: number): string {
  if (value == null) {
    return '—';
  }
  return `$${value.toFixed(decimals)}`;
}

interface PricingTableProps {
  models: ModelPricingDisplayData[];
  rowKeyPrefix: string;
}

function PricingTable({ models, rowKeyPrefix }: PricingTableProps) {
  return (
    <div className="pricing-table-wrapper">
      <table className="pricing-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Input ($/1M)</th>
            <th>Output ($/1M)</th>
            <th>Cache Read ($/1M)</th>
            <th>Cache Write ($/1M)</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => (
            <tr key={`${rowKeyPrefix}:${model.modelId}:${model.variantName ?? ''}`}>
              <td>
                <div className="model-name-cell">
                  <span className="model-name">{model.displayName}</span>
                  <ModelVariantBadges parameters={model.parameters ?? []} />
                </div>
              </td>
              <td className="number">{formatPrice(model.inputPer1M, 2)}</td>
              <td className="number">{formatPrice(model.outputPer1M, 2)}</td>
              <td className="number">{formatPrice(model.cacheReadPer1M, 3)}</td>
              <td className="number">{formatPrice(model.cacheWritePer1M, 3)}</td>
              <td className="notes">{model.notes ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PricesModal({
  models,
  enabledModels = [],
  loading = false,
  onClose,
}: PricesModalProps) {
  const [filters, setFilters] = useState<FilterState>({});
  const [openFilterDimension, setOpenFilterDimension] = useState<string | null>(
    null
  );

  const allModelsForFilters = useMemo(
    () => [...models, ...enabledModels],
    [models, enabledModels]
  );

  const parameterDimensions = useMemo(
    () => extractParameterDimensions(allModelsForFilters),
    [allModelsForFilters]
  );

  const filteredModels = useMemo(
    () => filterModelsByParameters(models, filters),
    [models, filters]
  );

  const filteredEnabledModels = useMemo(
    () => filterModelsByParameters(enabledModels, filters),
    [enabledModels, filters]
  );

  const modelsByProvider = useMemo(() => {
    return filteredModels.reduce<Record<string, ModelPricingDisplayData[]>>(
      (acc, model) => {
        if (!acc[model.provider]) {
          acc[model.provider] = [];
        }
        acc[model.provider]!.push(model);
        return acc;
      },
      {}
    );
  }, [filteredModels]);

  const providerOrder = useMemo(
    () =>
      Object.keys(modelsByProvider).sort((left, right) =>
        left.localeCompare(right)
      ),
    [modelsByProvider]
  );

  const handleFilterSelect = (dimension: string, value: string | undefined) => {
    setFilters((current) => ({
      ...current,
      [dimension]: value,
    }));
    setOpenFilterDimension(null);
  };

  const handleClearFilters = () => {
    setFilters({});
    setOpenFilterDimension(null);
  };

  const hasActiveFilters = Object.values(filters).some(
    (value) => value !== undefined
  );

  const hasVisibleModels =
    filteredEnabledModels.length > 0 || filteredModels.length > 0;

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal prices-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-labelledby="prices-modal-title"
      >
        <div className="prices-modal-header">
          <div className="prices-modal-title-row">
            <h2 id="prices-modal-title">Cursor Model Pricing</h2>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {!loading && parameterDimensions.length > 0 ? (
            <div className="prices-filter-bar">
              {parameterDimensions.map((dimension) => (
                <PricesFilterPill
                  key={dimension}
                  dimension={dimension}
                  selectedValue={filters[dimension]}
                  options={extractParameterValues(allModelsForFilters, dimension)}
                  isOpen={openFilterDimension === dimension}
                  onToggle={() =>
                    setOpenFilterDimension((current) =>
                      current === dimension ? null : dimension
                    )
                  }
                  onSelect={(value) => handleFilterSelect(dimension, value)}
                  onClose={() => setOpenFilterDimension(null)}
                />
              ))}
              {hasActiveFilters ? (
                <button
                  type="button"
                  className="prices-filter-clear"
                  onClick={handleClearFilters}
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : null}

          <p className="pricing-source">
            Source:{' '}
            <a
              href="https://cursor.com/docs/models-and-pricing"
              target="_blank"
              rel="noopener noreferrer"
            >
              Official Cursor Documentation
            </a>
          </p>
        </div>

        <div className="modal-body prices-modal-body">
          {loading ? (
            <div className="pricing-loading">
              <div className="spinner" aria-hidden="true" />
              <p>Loading model pricing…</p>
            </div>
          ) : models.length === 0 && enabledModels.length === 0 ? (
            <p className="pricing-empty">No model pricing data available.</p>
          ) : !hasVisibleModels ? (
            <p className="pricing-empty">No models match the selected filters.</p>
          ) : (
            <>
              {filteredEnabledModels.length > 0 ? (
                <div className="model-group model-group-active">
                  <h3 className="model-group-header model-group-header-active">
                    Your Active Models
                  </h3>
                  <PricingTable
                    models={filteredEnabledModels}
                    rowKeyPrefix="active"
                  />
                </div>
              ) : null}

              {providerOrder.map((provider) => (
                <div key={provider} className="model-group">
                  <h3 className="model-group-header">{provider}</h3>
                  <PricingTable
                    models={modelsByProvider[provider] ?? []}
                    rowKeyPrefix={provider}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
