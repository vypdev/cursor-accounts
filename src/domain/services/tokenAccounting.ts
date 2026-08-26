/** Maximum token count that can be represented without losing integer precision. */
export const MAX_SAFE_TOKEN_COUNT = Number.MAX_SAFE_INTEGER;

/** Number of decimal places retained for USD-cent estimates. */
export const COST_DECIMAL_PLACES = 6;

const COST_SCALE = 10 ** COST_DECIMAL_PLACES;

/**
 * Normalizes a token count at the domain boundary.
 *
 * Token counts are integer quantities. Missing, negative, non-finite, and
 * unsafe values are invalid and become zero for calculations.
 */
export function normalizeTokenCount(value: number | undefined): number {
  if (
    value == null ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_SAFE_TOKEN_COUNT
  ) {
    return 0;
  }
  return value;
}

/** Preserves the distinction between an absent and a valid zero count. */
export function normalizeOptionalTokenCount(
  value: number | undefined
): number | undefined {
  if (value == null || !Number.isSafeInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

/** Normalizes a USD-cent value while preserving a valid zero. */
export function normalizeCostCents(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return roundCostCents(value);
}

/** Removes binary floating-point noise without rounding estimates to whole cents. */
export function roundCostCents(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return value === 0 ? 0 : 0;
  }
  return Math.round(value * COST_SCALE) / COST_SCALE;
}

