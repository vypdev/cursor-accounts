#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const isProductionList =
  args[0] === 'list' && args.includes('--production');

if (isProductionList) {
  const result = spawnSync(
    'pnpm',
    [
      'list',
      '--prod',
      '--parseable',
      '--depth=99999',
      '--filter',
      '.',
      '--loglevel',
      'silent',
    ],
    { cwd: process.cwd(), encoding: 'utf8' }
  );

  const workspaceMappings = new Map([
    [
      path.resolve('packages/shared'),
      path.resolve('node_modules/@cursor-accounts/shared'),
    ],
    [
      path.resolve('packages/types'),
      path.resolve('node_modules/@cursor-accounts/types'),
    ],
  ]);
  const rootNodeModules = path.resolve('node_modules');
  const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
  const rootDependencyNames = new Set(
    Object.keys(rootPackage.dependencies ?? {})
  );
  const toPackagedPath = (entry) => {
    const workspacePath = workspaceMappings.get(entry);
    if (workspacePath) {
      return workspacePath;
    }

    const marker = `${path.sep}node_modules${path.sep}`;
    const markerIndex = entry.lastIndexOf(marker);
    if (markerIndex === -1) {
      return entry;
    }

    const packageName = entry.slice(markerIndex + marker.length);
    const candidate = path.join(rootNodeModules, packageName);
    const isRootRuntimeDependency =
      rootDependencyNames.has(packageName) ||
      packageName.startsWith('@cursor/sdk-');
    return isRootRuntimeDependency && existsSync(candidate)
      ? candidate
      : entry;
  };
  const output = [
    ...new Set(
      (result.stdout ?? '')
    .split(/\r?\n/)
    .map(toPackagedPath)
    .filter(Boolean)
    ),
  ]
    .join('\n');

  process.stdout.write(`${output}\n`);
  process.exit(result.status ?? 1);
}

const realNpm = process.env.VSCE_REAL_NPM ?? 'npm';
const result = spawnSync(realNpm, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
}
process.exit(result.status ?? 1);
