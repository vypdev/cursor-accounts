#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const NON_RUNTIME_DIRECTORY_NAMES = new Set([
  '.github',
  '.nyc_output',
  'coverage',
  'doc',
  'docs',
  'example',
  'examples',
  'test',
  'tests',
  '__tests__',
  'benchmark',
  'benchmarks',
  'gyp',
  'testdata',
  'scripts',
]);

function isNonRuntimeFile(name) {
  return (
    /\.(?:map|md|markdown|py|c|h|mk|yml|yaml)$/i.test(name) ||
    /^(?:test|tests|.*\.test|.*\.spec)(?:\.[^.]+)*$/i.test(name)
  );
}

function pruneDependencyTree(directory) {
  if (!fs.existsSync(directory)) {
    return 0;
  }

  let removed = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const targetPath = path.join(directory, entry.name);
    if (entry.isDirectory() && NON_RUNTIME_DIRECTORY_NAMES.has(entry.name)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      removed += 1;
      continue;
    }
    if (entry.isFile() && isNonRuntimeFile(entry.name)) {
      fs.rmSync(targetPath, { force: true });
      removed += 1;
      continue;
    }
    if (entry.isDirectory()) {
      removed += pruneDependencyTree(targetPath);
    }
  }
  return removed;
}

function pruneBetterSqliteBuildArtifacts(extensionRoot) {
  const root = path.join(extensionRoot, 'node_modules', 'better-sqlite3');
  const removable = [
    path.join(root, 'deps'),
    path.join(root, 'build', 'Release', '.deps'),
    path.join(root, 'build', 'Release', 'obj.target'),
    path.join(root, 'build', 'test_extension.target.mk'),
    path.join(root, 'build', 'Release', 'test_extension.node'),
  ];
  let removed = 0;
  for (const targetPath of removable) {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}

/** Remove non-runtime dependency artifacts from a temporary VSIX copy. */
export function sanitizeVsix(vsixPath) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-accounts-vsix-'));
  const rebuiltPath = `${vsixPath}.sanitized`;
  try {
    execFileSync('unzip', ['-q', vsixPath, '-d', tempRoot]);
    const extensionRoot = path.join(tempRoot, 'extension');
    const removed =
      pruneDependencyTree(path.join(extensionRoot, 'node_modules')) +
      pruneBetterSqliteBuildArtifacts(extensionRoot);

    execFileSync('zip', ['-q', '-r', rebuiltPath, '.'], { cwd: tempRoot });
    fs.renameSync(rebuiltPath, vsixPath);
    console.log(`Sanitized VSIX dependency artifacts: ${removed} paths removed`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (fs.existsSync(rebuiltPath)) {
      fs.rmSync(rebuiltPath, { force: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const vsixPath = process.argv[2];
  if (!vsixPath) {
    throw new Error('Usage: node scripts/sanitize-vsix.mjs <path-to-vsix>');
  }
  sanitizeVsix(path.resolve(vsixPath));
}
