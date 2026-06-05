import type { ModelPricingDisplayData } from '../types';

export type FilterState = Record<string, string | undefined>;

export function extractParameterDimensions(
  models: readonly ModelPricingDisplayData[]
): string[] {
  const dimensions = new Set<string>();

  for (const model of models) {
    for (const parameter of model.parameters ?? []) {
      dimensions.add(parameter.id);
    }
  }

  return Array.from(dimensions).sort((left, right) => left.localeCompare(right));
}

export function extractParameterValues(
  models: readonly ModelPricingDisplayData[],
  dimension: string
): string[] {
  const values = new Set<string>();

  for (const model of models) {
    const parameter = model.parameters?.find((entry) => entry.id === dimension);
    if (parameter) {
      values.add(parameter.value);
    }
  }

  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

export function hasActiveFilters(filters: FilterState): boolean {
  return Object.values(filters).some((value) => value !== undefined);
}

export function modelMatchesFilters(
  model: ModelPricingDisplayData,
  filters: FilterState
): boolean {
  for (const [dimension, selectedValue] of Object.entries(filters)) {
    if (selectedValue === undefined) {
      continue;
    }

    const parameter = model.parameters?.find((entry) => entry.id === dimension);
    if (!parameter || parameter.value !== selectedValue) {
      return false;
    }
  }

  return true;
}

export function filterModelsByParameters(
  models: readonly ModelPricingDisplayData[],
  filters: FilterState
): ModelPricingDisplayData[] {
  if (!hasActiveFilters(filters)) {
    return [...models];
  }

  return models.filter((model) => modelMatchesFilters(model, filters));
}

export function formatDimensionLabel(dimension: string): string {
  if (dimension.length === 0) {
    return dimension;
  }

  return dimension.charAt(0).toUpperCase() + dimension.slice(1);
}
