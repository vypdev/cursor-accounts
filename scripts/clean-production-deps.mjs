#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const root = process.cwd();
const nodeModulesDir = path.join(root, 'node_modules');

function collectExtraneousPaths() {
  // pnpm owns this workspace's dependency graph. npm list interprets pnpm's
  // hoisted and virtual-store layout as invalid and reports false extraneous
  // and missing-peer errors, so there is no reliable npm path list here.
  return [];
}

function collectProductionPaths() {
  const output = execSync(
    'pnpm list --prod --parseable --depth=99999 --filter . --loglevel silent',
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const paths = new Set();
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('npm error')) {
      continue;
    }
    if (trimmed.startsWith(nodeModulesDir)) {
      paths.add(trimmed);
    }
  }

  return paths;
}

function topLevelPackageName(relativePath) {
  const parts = relativePath.split(path.sep);
  if (parts[0]?.startsWith('@')) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}

function listTopLevelPackages() {
  const packages = [];

  for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (entry.name === '.bin') {
      continue;
    }
    if (!entry.isDirectory()) {
      continue;
    }

    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(nodeModulesDir, entry.name);
      for (const scopedEntry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (scopedEntry.isDirectory()) {
          packages.push(`${entry.name}/${scopedEntry.name}`);
        }
      }
      continue;
    }

    packages.push(entry.name);
  }

  return packages;
}

function removePath(targetPath) {
  if (!targetPath.startsWith(nodeModulesDir)) {
    return false;
  }

  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
    return true;
  }

  return false;
}

function readRootDevDependencyNames() {
  const packageJsonPath = path.join(root, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return Object.keys(packageJson.devDependencies ?? {});
}

function readRootDependencyNames() {
  const packageJsonPath = path.join(root, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return Object.keys(packageJson.dependencies ?? {});
}

function pruneNonProductionTopLevelPackages() {
  const productionPaths = collectProductionPaths();
  const allowedTopLevel = new Set(readRootDevDependencyNames());
  for (const dependencyName of readRootDependencyNames()) {
    allowedTopLevel.add(dependencyName);
  }

  for (const productionPath of productionPaths) {
    const relativePath = path.relative(nodeModulesDir, productionPath);
    if (!relativePath || relativePath.startsWith('..')) {
      continue;
    }
    allowedTopLevel.add(topLevelPackageName(relativePath));
  }

  let removed = 0;
  for (const packageName of listTopLevelPackages()) {
    if (allowedTopLevel.has(packageName)) {
      continue;
    }

    const targetPath = packageName.startsWith('@')
      ? path.join(nodeModulesDir, ...packageName.split('/'))
      : path.join(nodeModulesDir, packageName);

    if (removePath(targetPath)) {
      removed += 1;
    }
  }

  if (removed > 0) {
    console.log(`Removed ${removed} non-production top-level packages from node_modules`);
  }
}

function assertProductionTreeValid() {
  const productionPaths = collectProductionPaths();
  if (productionPaths.size === 0) {
    throw new Error('Production dependency tree could not be resolved by pnpm');
  }
}

export function cleanProductionDeps() {
  let removed = 0;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const extraneousPaths = collectExtraneousPaths();
    if (extraneousPaths.length === 0) {
      break;
    }

    for (const targetPath of extraneousPaths) {
      if (removePath(targetPath)) {
        removed += 1;
      }
    }
  }

  if (removed > 0) {
    console.log(`Removed ${removed} extraneous packages from node_modules`);
  }

  pruneNonProductionTopLevelPackages();
  assertProductionTreeValid();
}
