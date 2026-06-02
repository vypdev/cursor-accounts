#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const root = process.cwd();
const nodeModulesDir = path.join(root, 'node_modules');

function collectExtraneousPaths() {
  let output = '';

  try {
    execSync('npm list --production --parseable --depth=99999 --loglevel=error', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return [];
  } catch (error) {
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }

  const paths = new Set();
  for (const line of output.split('\n')) {
    const match = line.match(/^npm error extraneous: [^ ]+ (.+)$/);
    if (match?.[1]) {
      paths.add(match[1].trim());
    }
  }

  return [...paths];
}

function collectProductionPaths() {
  let output = '';

  try {
    output = execSync('npm list --production --parseable --depth=99999 --loglevel=silent', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }

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

function pruneNonProductionTopLevelPackages() {
  const productionPaths = collectProductionPaths();
  const allowedTopLevel = new Set(readRootDevDependencyNames());

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
  try {
    execSync('npm list --production --parseable --depth=99999 --loglevel=error', {
      cwd: root,
      stdio: 'pipe',
    });
    return;
  } catch (error) {
    const remaining = collectExtraneousPaths();
    if (remaining.length > 0) {
      throw new Error(
        `Production dependency tree still invalid after cleanup (${remaining.length} extraneous packages remain)`
      );
    }

    const message = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    if (message.includes('npm error invalid:')) {
      throw new Error('Production dependency tree still invalid after cleanup');
    }
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
