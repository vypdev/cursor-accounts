/** Model parameter from Cursor catalog (e.g. fast=true, thinking=true). */
export interface ModelCatalogParameter {
  readonly id: string;
  readonly value: string;
}

/** Variant row inside availableDefaultModels2. */
export interface ModelCatalogVariant {
  readonly parameterValues?: ModelCatalogParameter[];
  readonly legacySlug?: string;
  readonly variantStringRepresentation?: string;
  readonly isMaxMode?: boolean;
  readonly displayName?: string;
}

/** Entry in Cursor's availableDefaultModels2 catalog. */
export interface ModelCatalogEntry {
  readonly name?: string;
  readonly serverModelName?: string;
  readonly legacySlugs?: string[];
  readonly idAliases?: string[];
  readonly variants?: ModelCatalogVariant[];
  /** Whether this base model is enabled by default in the picker. */
  readonly defaultOn?: boolean;
}
