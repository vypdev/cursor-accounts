const VARIANT_SUFFIXES = ['fast', 'thinking', 'max', 'high', 'mini', 'low'];

const SPACE_SUFFIX = new RegExp(
  `\\s+(${VARIANT_SUFFIXES.join('|')})$`,
  'i'
);
const HYPHEN_SUFFIX = new RegExp(
  `-(${VARIANT_SUFFIXES.join('|')})$`,
  'i'
);

export function normalizeModelBaseName(model: string): string {
  const trimmed = model.trim();
  if (!trimmed || trimmed === 'auto' || trimmed === 'unknown') {
    return trimmed;
  }

  let normalized = trimmed;
  let changed = true;
  while (changed) {
    changed = false;
    const withoutSpace = normalized.replace(SPACE_SUFFIX, '');
    const withoutHyphen = normalized.replace(HYPHEN_SUFFIX, '');
    if (withoutSpace !== normalized) {
      normalized = withoutSpace.trim();
      changed = true;
    } else if (withoutHyphen !== normalized) {
      normalized = withoutHyphen.trim();
      changed = true;
    }
  }

  return normalized;
}

export function modelBaseComparisonKey(model: string): string {
  return normalizeModelBaseName(model)
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
