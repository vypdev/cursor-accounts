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

  assertProductionTreeValid();
}
