import {
  ComposerModelConfig,
  ModelParameter,
  ResolvedModel,
} from './types';

export interface ModelCatalogVariant {
  parameterValues?: ModelParameter[];
  legacySlug?: string;
  variantStringRepresentation?: string;
  isMaxMode?: boolean;
  displayName?: string;
}

export interface ModelCatalogEntry {
  name?: string;
  serverModelName?: string;
  legacySlugs?: string[];
  idAliases?: string[];
  variants?: ModelCatalogVariant[];
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '').trim();
}

function normalizeParameters(parameters: ModelParameter[]): ModelParameter[] {
  return [...parameters]
    .filter((p) => typeof p.id === 'string' && typeof p.value === 'string')
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function buildVariantString(
  modelId: string,
  parameters: ModelParameter[]
): string {
  const normalized = normalizeParameters(parameters);
  if (normalized.length === 0) {
    return `${modelId}[]`;
  }
  const pairs = normalized.map((p) => `${p.id}=${p.value}`).join(',');
  return `${modelId}[${pairs}]`;
}

function parametersMatch(
  left: ModelParameter[],
  right: ModelParameter[]
): boolean {
  const a = normalizeParameters(left);
  const b = normalizeParameters(right);
  if (a.length !== b.length) {
    return false;
  }
  return a.every(
    (param, index) =>
      param.id === b[index].id && param.value === b[index].value
  );
}

function findCatalogEntry(
  catalog: ModelCatalogEntry[],
  modelId: string
): ModelCatalogEntry | undefined {
  return catalog.find(
    (entry) =>
      entry.name === modelId ||
      entry.serverModelName === modelId ||
      entry.legacySlugs?.includes(modelId) ||
      entry.idAliases?.includes(modelId)
  );
}

function findMatchingVariant(
  entry: ModelCatalogEntry,
  variantString: string,
  parameters: ModelParameter[],
  maxMode: boolean
): ModelCatalogVariant | undefined {
  const variants = entry.variants ?? [];
  const byString = variants.find(
    (variant) => variant.variantStringRepresentation === variantString
  );
  if (byString && (byString.isMaxMode ?? false) === maxMode) {
    return byString;
  }

  return variants.find(
    (variant) =>
      (variant.isMaxMode ?? false) === maxMode &&
      parametersMatch(variant.parameterValues ?? [], parameters)
  );
}

export function parseModelCatalog(raw: string | null): ModelCatalogEntry[] {
  if (!raw?.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as {
      availableDefaultModels2?: ModelCatalogEntry[];
    };
    return Array.isArray(parsed.availableDefaultModels2)
      ? parsed.availableDefaultModels2
      : [];
  } catch {
    return [];
  }
}

export function resolveModelConfig(
  config: ComposerModelConfig | undefined,
  catalog: ModelCatalogEntry[]
): ResolvedModel {
  const modelName = config?.modelName?.trim() || 'unknown';
  const maxMode = config?.maxMode ?? false;
  const selected = config?.selectedModels?.[0];
  const baseModelId = selected?.modelId?.trim() || modelName;
  const parameters = normalizeParameters(selected?.parameters ?? []);

  if (!config?.selectedModels?.length) {
    return {
      slug: modelName,
      baseModelId: modelName,
      maxMode,
      parameters: [],
      resolved: modelName === 'default' || modelName === 'unknown',
    };
  }

  if (baseModelId === 'default' && parameters.length === 0) {
    return {
      slug: 'default',
      baseModelId: 'default',
      maxMode,
      parameters: [],
      resolved: true,
    };
  }

  const entry = findCatalogEntry(catalog, baseModelId);
  if (!entry) {
    return {
      slug: baseModelId,
      baseModelId,
      maxMode,
      parameters,
      resolved: false,
    };
  }

  const variantString = buildVariantString(baseModelId, parameters);
  const variant = findMatchingVariant(entry, variantString, parameters, maxMode);
  if (!variant?.legacySlug) {
    return {
      slug: baseModelId,
      baseModelId,
      maxMode,
      parameters,
      resolved: false,
    };
  }

  return {
    slug: variant.legacySlug,
    baseModelId,
    maxMode,
    parameters,
    resolved: true,
    displayName: variant.displayName
      ? stripHtml(variant.displayName)
      : undefined,
  };
}
