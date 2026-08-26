/** Origin of a persisted cost value. */
export type CostSource =
  | 'server'
  | 'model_pricing'
  | 'fallback'
  | 'provided'
  | 'unknown'
  | 'mixed';

/** Cost provenance attached to an individual event or aggregate. */
export interface CostProvenance {
  readonly source: CostSource;
  readonly pricingSnapshotVersion?: string;
}

const COST_SOURCES = new Set<CostSource>([
  'server',
  'model_pricing',
  'fallback',
  'provided',
  'unknown',
  'mixed',
]);

/** Normalizes untrusted persistence input to a known provenance value. */
export function normalizeCostSource(value: unknown): CostSource {
  return typeof value === 'string' && COST_SOURCES.has(value as CostSource)
    ? (value as CostSource)
    : 'unknown';
}

/**
 * Combines provenance for an aggregate without claiming a single source when
 * events were calculated with different evidence.
 */
export function mergeCostProvenance(
  existing: CostProvenance | undefined,
  next: CostProvenance
): CostProvenance {
  if (!existing) {
    return next;
  }
  if (existing.source === 'mixed') {
    return { source: 'mixed' };
  }
  if (existing.source === 'unknown') {
    return next;
  }
  if (next.source === 'unknown') {
    return existing;
  }
  if (
    existing.source === next.source &&
    existing.pricingSnapshotVersion === next.pricingSnapshotVersion
  ) {
    return existing;
  }
  return { source: 'mixed' };
}
