import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(repositoryRoot, '..');

const DOMAIN_EXTERNAL_PACKAGES = new Set([
  '@cursor-accounts/shared',
  '@cursor-accounts/types',
]);

const APPLICATION_EXTERNAL_PACKAGES = new Set([
  '@cursor-accounts/shared',
  '@cursor-accounts/types',
]);

const APPLICATION_INFRASTRUCTURE_LAYERS = new Set([
  'api',
  'auth',
  'commands',
  'cursor',
  'github',
  'logging',
  'migrations',
  'modelEfficiency',
  'persistence',
  'profiles',
  'proxy',
  'services',
  'storage',
  'ui',
  'validation',
]);

const SHARED_KERNEL_LAYERS = new Set(['packages/types', 'packages/shared']);
const TEST_LAYERS = new Set(['test', 'tests']);

async function collectTypeScriptFiles(directory, { includeTests = false } = {}) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === 'dist') {
      continue;
    }
    if (!includeTests && ['test', 'tests', '__tests__'].includes(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(entryPath, { includeTests })));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(entryPath);
    }
  }
  return files;
}

function layerOf(root, filePath) {
  const relative = path.relative(root, filePath).split(path.sep);
  if (relative[0] === 'src') {
    if (relative[1] === 'composition' || relative[1] === 'extension.ts') return 'composition';
    return relative[1] ?? 'src';
  }
  if (relative[0] === 'packages') return `packages/${relative[1] ?? 'unknown'}`;
  return relative[0] ?? 'unknown';
}

function isInside(root, filePath) {
  const relative = path.relative(root, filePath);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..';
}

function sourceFileKind(filePath) {
  return filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function extractImports(source, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourceFileKind(filePath)
  );
  const imports = new Map();

  const addImport = (specifierNode, kind) => {
    if (!ts.isStringLiteralLike(specifierNode)) return;
    const specifier = specifierNode.text;
    if (!imports.has(specifier)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(specifierNode.getStart(sourceFile));
      imports.set(specifier, { specifier, kind, line: line + 1 });
    }
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      addImport(node.moduleSpecifier, node.importClause?.isTypeOnly ? 'type' : 'runtime');
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      addImport(node.moduleSpecifier, 'export');
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) {
        addImport(node.moduleReference.expression, 'runtime');
      }
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isRequire) && node.arguments.length > 0) {
        addImport(node.arguments[0], isDynamicImport ? 'dynamic' : 'require');
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...imports.values()];
}

function resolveWithTypeScript(filePath, specifier, root) {
  const compilerOptions = {
    allowJs: false,
    baseUrl: root,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    target: ts.ScriptTarget.ES2022,
  };
  const result = ts.resolveModuleName(specifier, filePath, compilerOptions, ts.sys);
  const resolvedFileName = result.resolvedModule?.resolvedFileName;
  return resolvedFileName ? path.resolve(resolvedFileName) : undefined;
}

function resolveSourceFile(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mts`,
    `${basePath}.cts`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.mts'),
    path.join(basePath, 'index.cts'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

async function loadWorkspacePackageAliases(root) {
  const manifestPaths = [path.join(root, 'package.json')];
  for (const directory of ['packages', 'webview']) {
    const directoryPath = path.join(root, directory);
    if (!existsSync(directoryPath)) continue;
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        manifestPaths.push(path.join(directoryPath, entry.name, 'package.json'));
      }
    }
  }

  const aliases = [];
  for (const manifestPath of manifestPaths) {
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (typeof manifest.name !== 'string') continue;
    const packageDirectory = path.dirname(manifestPath);
    const sourceDirectory = path.join(packageDirectory, 'src');
    if (!existsSync(sourceDirectory)) continue;
    aliases.push({ name: manifest.name, sourceDirectory });
  }
  return aliases.sort((left, right) => right.name.length - left.name.length);
}

function resolveWorkspacePackageImport(specifier, aliases) {
  for (const alias of aliases) {
    if (specifier !== alias.name && !specifier.startsWith(`${alias.name}/`)) continue;
    const suffix = specifier.slice(alias.name.length).replace(/^\//, '');
    const candidate = suffix ? path.join(alias.sourceDirectory, suffix) : path.join(alias.sourceDirectory, 'index');
    return resolveSourceFile(candidate);
  }
  return undefined;
}

function resolveImport({ filePath, specifier, root, workspaceAliases }) {
  const resolvedByTypeScript = resolveWithTypeScript(filePath, specifier, root);
  if (resolvedByTypeScript && isInside(root, resolvedByTypeScript)) {
    return resolvedByTypeScript;
  }

  if (!specifier.startsWith('.')) {
    return resolveWorkspacePackageImport(specifier, workspaceAliases);
  }

  const sourceSpecifier = specifier.replace(/\.(?:c|m)?js$/, '');
  return resolveSourceFile(path.resolve(path.dirname(filePath), sourceSpecifier));
}

function isPackageLayer(layer) {
  return layer?.startsWith('packages/');
}

function isTestLayer(layer) {
  return TEST_LAYERS.has(layer);
}

function isForbidden(sourceLayer, targetLayer, specifier) {
  if (targetLayer === 'composition' && sourceLayer !== 'composition' && !isTestLayer(sourceLayer)) {
    return 'composition-root-only';
  }

  if (sourceLayer === 'domain') {
    if (!targetLayer) {
      return DOMAIN_EXTERNAL_PACKAGES.has(specifier) ? undefined : 'domain-external-dependency';
    }
    return targetLayer === 'domain' || SHARED_KERNEL_LAYERS.has(targetLayer)
      ? undefined
      : 'domain-depends-outward';
  }

  if (sourceLayer === 'application') {
    if (!targetLayer) {
      if (specifier.startsWith('node:') || specifier === 'vscode') {
        return 'application-runtime-dependency';
      }
      return APPLICATION_EXTERNAL_PACKAGES.has(specifier)
        ? undefined
        : 'application-external-dependency';
    }
    if (APPLICATION_INFRASTRUCTURE_LAYERS.has(targetLayer)) {
      return 'application-depends-on-infrastructure';
    }
    return targetLayer === 'application' || targetLayer === 'domain' || isPackageLayer(targetLayer)
      ? undefined
      : 'application-invalid-target';
  }

  if (sourceLayer === 'proxy' && targetLayer === 'ui') {
    return 'infrastructure-depends-on-interface';
  }

  if (isPackageLayer(sourceLayer)) {
    if (specifier === 'vscode' || specifier.startsWith('node:')) {
      return 'shared-kernel-runtime-dependency';
    }
    if (targetLayer && targetLayer.startsWith('src')) {
      return 'shared-kernel-depends-on-extension';
    }
  }

  return undefined;
}

export async function runArchitectureCheck({
  root = defaultRoot,
  includeTests = false,
  sourceRoots = [
    path.join(root, 'src'),
    path.join(root, 'packages', 'types', 'src'),
    path.join(root, 'packages', 'shared', 'src'),
  ],
} = {}) {
  const files = (
    await Promise.all(sourceRoots.map((sourceRoot) => collectTypeScriptFiles(sourceRoot, { includeTests })))
  ).flat();
  const fileSet = new Set(files.map((filePath) => path.resolve(filePath)));
  const workspaceAliases = await loadWorkspacePackageAliases(root);
  const graph = new Map();
  const violations = [];

  for (const filePath of files) {
    const source = await fs.readFile(filePath, 'utf8');
    const sourceLayer = layerOf(root, filePath);
    const edges = [];

    for (const importInfo of extractImports(source, filePath)) {
      const { specifier, kind, line } = importInfo;
      const targetPath = resolveImport({ filePath, specifier, root, workspaceAliases });
      const targetLayer = targetPath && isInside(root, targetPath) ? layerOf(root, targetPath) : undefined;
      if (specifier.startsWith('.') && (!targetPath || !isInside(root, targetPath))) {
        violations.push({
          file: path.relative(root, filePath),
          line,
          kind,
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
      const rule = isForbidden(sourceLayer, targetLayer, specifier);
      if (rule) {
        violations.push({
          file: path.relative(root, filePath),
          line,
          kind,
          specifier,
          sourceLayer,
          targetLayer,
          rule,
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
  const jsonOutput = process.argv.includes('--json');

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    if (result.violations.length > 0 || result.cycles.length > 0) process.exitCode = 1;
    return;
  }

  if (result.violations.length > 0) {
    console.error('Architecture boundary violations:');
    for (const violation of result.violations) {
      const target = violation.targetLayer ? ` [${violation.targetLayer}]` : '';
      console.error(
        `- ${violation.file}:${violation.line} -> ${violation.specifier}${target} (${violation.rule})`
      );
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
