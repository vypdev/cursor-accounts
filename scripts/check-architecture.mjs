import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(repositoryRoot, '..');

const DOMAIN_EXTERNAL_PACKAGES = new Set([
  '@cursor-accounts/shared',
  '@cursor-accounts/types',
]);

const APPLICATION_INFRASTRUCTURE_LAYERS = new Set([
  'api',
  'auth',
  'commands',
  'composition',
  'cursor',
  'logging',
  'migrations',
  'modelEfficiency',
  'persistence',
  'profiles',
  'proxy',
  'services',
  'storage',
  'ui',
]);

async function collectTypeScriptFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === 'dist') {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(entryPath)));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(entryPath);
    }
  }
  return files;
}

function layerOf(root, filePath) {
  const relative = path.relative(root, filePath).split(path.sep);
  if (relative[0] === 'src') return relative[1] ?? 'src';
  if (relative[0] === 'packages') return `packages/${relative[1] ?? 'unknown'}`;
  return relative[0] ?? 'unknown';
}

function resolveRelativeImport(filePath, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const sourceSpecifier = specifier.replace(/\.(?:c|m)?js$/, '');
  const base = path.resolve(path.dirname(filePath), sourceSpecifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function extractImports(source) {
  const imports = new Set();
  const pattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
  const dynamicPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(pattern)) imports.add(match[1]);
  for (const match of source.matchAll(dynamicPattern)) imports.add(match[1]);
  return imports;
}

function isPackageLayer(layer) {
  return layer?.startsWith('packages/');
}

function isForbidden(sourceLayer, targetLayer, specifier) {
  if (sourceLayer === 'domain') {
    if (!targetLayer) {
      return !DOMAIN_EXTERNAL_PACKAGES.has(specifier);
    }
    return targetLayer !== 'domain' && !isPackageLayer(targetLayer);
  }

  if (sourceLayer === 'application') {
    return APPLICATION_INFRASTRUCTURE_LAYERS.has(targetLayer);
  }

  if (sourceLayer === 'proxy') {
    return targetLayer === 'ui';
  }

  if (isPackageLayer(sourceLayer)) {
    return (
      specifier === 'vscode' ||
      specifier.startsWith('node:') ||
      Boolean(targetLayer && targetLayer === 'src')
    );
  }

  return false;
}

export async function runArchitectureCheck({
  root = defaultRoot,
  sourceRoots = [
    path.join(root, 'src'),
    path.join(root, 'packages', 'types', 'src'),
    path.join(root, 'packages', 'shared', 'src'),
  ],
} = {}) {
  const files = (await Promise.all(sourceRoots.map(collectTypeScriptFiles))).flat();
  const fileSet = new Set(files);
  const graph = new Map();
  const violations = [];

  for (const filePath of files) {
    const source = await fs.readFile(filePath, 'utf8');
    const sourceLayer = layerOf(root, filePath);
    const edges = [];

    for (const specifier of extractImports(source)) {
      const targetPath = resolveRelativeImport(filePath, specifier);
      const targetLayer = targetPath ? layerOf(root, targetPath) : undefined;
      if (!targetPath && specifier.startsWith('.')) {
        violations.push({
          file: path.relative(root, filePath),
          specifier,
          sourceLayer,
          targetLayer,
          rule: 'unresolved-relative-import',
        });
        continue;
      }
      if (targetPath && fileSet.has(targetPath)) {
        edges.push(targetPath);
      }
      if (isForbidden(sourceLayer, targetLayer, specifier)) {
        violations.push({
          file: path.relative(root, filePath),
          specifier,
          sourceLayer,
          targetLayer,
        });
      }
    }

    graph.set(filePath, edges);
  }

  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(filePath) {
    if (visiting.has(filePath)) {
      const start = stack.indexOf(filePath);
      cycles.push([...stack.slice(start), filePath].map((item) => path.relative(root, item)).join(' -> '));
      return;
    }
    if (visited.has(filePath)) return;

    visiting.add(filePath);
    stack.push(filePath);
    for (const dependency of graph.get(filePath) ?? []) visit(dependency);
    stack.pop();
    visiting.delete(filePath);
    visited.add(filePath);
  }

  for (const filePath of files) visit(filePath);

  return {
    files,
    violations,
    cycles: [...new Set(cycles)],
  };
}

async function main() {
  const result = await runArchitectureCheck();

  if (result.violations.length > 0) {
    console.error('Architecture boundary violations:');
    for (const violation of result.violations) {
      const target = violation.targetLayer ? ` [${violation.targetLayer}]` : '';
      console.error(`- ${violation.file} -> ${violation.specifier}${target}`);
    }
  }

  if (result.cycles.length > 0) {
    console.error('Import cycles:');
    for (const cycle of result.cycles) console.error(`- ${cycle}`);
  }

  if (result.violations.length > 0 || result.cycles.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`Architecture checks passed for ${result.files.length} TypeScript files.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
