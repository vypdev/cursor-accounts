import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const sourceRoots = [
  path.join(root, 'src'),
  path.join(root, 'packages', 'types', 'src'),
  path.join(root, 'packages', 'shared', 'src'),
];

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

function layerOf(filePath) {
  const relative = path.relative(root, filePath).split(path.sep);
  if (relative[0] === 'src') return relative[1] ?? 'src';
  if (relative[0] === 'packages') return `packages/${relative[1] ?? 'unknown'}`;
  return relative[0] ?? 'unknown';
}

function resolveRelativeImport(filePath, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const base = path.resolve(path.dirname(filePath), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')];
  return candidates.find((candidate) => candidate.endsWith('.ts') || candidate.endsWith('.tsx'));
}

function extractImports(source) {
  const imports = new Set();
  const pattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
  const dynamicPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(pattern)) imports.add(match[1]);
  for (const match of source.matchAll(dynamicPattern)) imports.add(match[1]);
  return imports;
}

function isForbidden(sourceLayer, targetLayer, specifier) {
  if (sourceLayer === 'domain') {
    return (
      ['api', 'ui', 'profiles', 'services', 'commands', 'proxy', 'persistence', 'auth', 'storage'].includes(targetLayer) ||
      ['vscode', 'http-mitm-proxy', 'httpolyglot'].includes(specifier)
    );
  }
  if (['api', 'profiles', 'services', 'auth', 'storage', 'persistence'].includes(sourceLayer)) {
    return targetLayer === 'ui';
  }
  if (sourceLayer === 'packages/types' || sourceLayer === 'packages/shared') {
    return specifier === 'vscode' || specifier.startsWith('node:');
  }
  return false;
}

const files = (await Promise.all(sourceRoots.map(collectTypeScriptFiles))).flat();
const graph = new Map();
const violations = [];

for (const filePath of files) {
  const source = await fs.readFile(filePath, 'utf8');
  const sourceLayer = layerOf(filePath);
  const edges = [];
  for (const specifier of extractImports(source)) {
    const targetPath = resolveRelativeImport(filePath, specifier);
    if (!targetPath) continue;
    const targetLayer = layerOf(targetPath);
    edges.push(targetPath);
    if (isForbidden(sourceLayer, targetLayer, specifier)) {
      violations.push(`${path.relative(root, filePath)} -> ${specifier}`);
    }
  }
  graph.set(filePath, edges.filter((edge) => files.includes(edge)));
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

if (violations.length > 0) {
  console.error('Architecture boundary violations:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}

if (cycles.length > 0) {
  console.error('Import cycles:');
  for (const cycle of [...new Set(cycles)]) console.error(`- ${cycle}`);
  process.exitCode = 1;
}

if (violations.length === 0 && cycles.length === 0) {
  console.log(`Architecture checks passed for ${files.length} TypeScript files.`);
}
