import { execFileSync } from 'child_process';
import { detectNativeTarget } from './native-binary-target.mjs';
import { PLATFORM_SDK_PACKAGE } from './build-targets.mjs';

export const ZIP_MAX_BUFFER = 16 * 1024 * 1024;

const NATIVE_BINDING_PATTERN =
  /^extension\/node_modules\/better-sqlite3\/(?:build\/Release|[^/]+\/build\/Release)\/better_sqlite3\.node$/;

export const FORBIDDEN_VSIX_PATTERNS = [
  'extension/.repowise/',
  'extension/graphify-out/',
  'extension/coverage/',
  'extension/webview/src/',
  'extension/webview/node_modules/',
  'extension/.build-backup/',
  'extension/.tmp-proto-test/',
  'extension/.pnpm-store/',
  'extension/pnpm-store/',
  'extension/packages/',
  'extension/docs/',
  'extension/scripts/',
];

export const FORBIDDEN_VSIX_REGEX_PATTERNS = [
  /^extension\/node_modules\/.+\/(?:docs|coverage|tests?|scripts|gyp|testdata)\//,
];

function requiredChecks(target, includeMigrations) {
  const checks = [
    { label: 'webview bundle', pattern: /^extension\/webview-dist\/bundle\.js$/ },
    { label: '@cursor/sdk', pattern: /^extension\/node_modules\/@cursor\/sdk\/package\.json$/ },
    {
      label: 'undici',
      pattern: /^extension\/node_modules\/(?:\.pnpm\/undici@[^/]+\/node_modules\/undici|undici)\/package\.json$/,
    },
    {
      label: 'bindings',
      pattern: /^extension\/node_modules\/(?:\.pnpm\/bindings@[^/]+\/node_modules\/bindings|bindings)\/package\.json$/,
    },
  ];

  if (includeMigrations) {
    checks.push({
      label: 'efficiency SQL migrations',
      pattern: /^extension\/out\/persistence\/migrations\/001_initial_schema\.sql$/,
    });
  }

  if (target && PLATFORM_SDK_PACKAGE[target]) {
    checks.push({
      label: `@cursor/sdk platform package (${target})`,
      pattern: new RegExp(
        `^extension/node_modules/${escapeRegExp(PLATFORM_SDK_PACKAGE[target])}/package\\.json$`
      ),
    });
  }

  return checks;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function listVsixEntries(vsixPath) {
  return execFileSync('unzip', ['-Z1', vsixPath], {
    encoding: 'utf8',
    maxBuffer: ZIP_MAX_BUFFER,
  })
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function readVsixEntry(vsixPath, entryName) {
  return execFileSync('unzip', ['-p', vsixPath, entryName], {
    maxBuffer: ZIP_MAX_BUFFER,
  });
}

export function inspectVsixArtifact(
  vsixPath,
  { target, includeMigrations = false } = {}
) {
  const entries = listVsixEntries(vsixPath);
  const checks = requiredChecks(target, includeMigrations).map((check) => ({
    ...check,
    present: entries.some((entry) => check.pattern.test(entry)),
  }));
  const forbidden = [
    ...FORBIDDEN_VSIX_PATTERNS.map((pattern) => ({
      pattern,
      present: entries.some((entry) => entry.includes(pattern)),
    })),
    ...FORBIDDEN_VSIX_REGEX_PATTERNS.map((pattern) => ({
      pattern,
      present: entries.some((entry) => pattern.test(entry)),
    })),
  ];

  let nativeTarget;
  let nativeError;
  if (target) {
    const nativeEntry = entries.find((entry) => NATIVE_BINDING_PATTERN.test(entry));
    if (!nativeEntry) {
      nativeError = new Error('native binding entry not found');
    } else {
      try {
        nativeTarget = detectNativeTarget(readVsixEntry(vsixPath, nativeEntry));
      } catch (error) {
        nativeError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  return { checks, entries, forbidden, nativeTarget, nativeError };
}

export function assertVsixArtifact(
  inspection,
  { target } = {}
) {
  const missing = inspection.checks.filter((check) => !check.present);
  if (missing.length > 0) {
    throw new Error(
      `VSIX verification failed: missing ${missing
        .map((check) => check.label)
        .join(', ')}`
    );
  }

  const forbidden = inspection.forbidden.filter((check) => check.present);
  if (forbidden.length > 0) {
    throw new Error(
      `VSIX verification failed: forbidden artifact ${String(forbidden[0].pattern)}`
    );
  }

  if (target && inspection.nativeError) {
    throw new Error(
      `VSIX verification failed: ${inspection.nativeError.message}`
    );
  }
  if (target && inspection.nativeTarget !== target) {
    throw new Error(
      `VSIX verification failed: expected native target ${target}, got ${inspection.nativeTarget ?? 'unknown'}`
    );
  }
}
