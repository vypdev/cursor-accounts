#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const nvmrc = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();
const requiredNodeMajor = Number.parseInt(nvmrc.replace(/^v/, ''), 10);
const packageManagerMatch = /^pnpm@(\d+\.\d+\.\d+)$/.exec(packageJson.packageManager ?? '');

if (!Number.isInteger(requiredNodeMajor) || !packageManagerMatch) {
  throw new Error('Invalid toolchain declaration: expected a numeric .nvmrc and packageManager pnpm version.');
}

const requiredPnpmVersion = packageManagerMatch[1];
const currentNodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const pnpmResult = spawnSync(pnpmCommand, ['--version'], { encoding: 'utf8' });

if (pnpmResult.error || pnpmResult.status !== 0) {
  throw new Error(`Unable to execute ${pnpmCommand}: ${pnpmResult.error?.message ?? pnpmResult.stderr}`);
}

const currentPnpmVersion = pnpmResult.stdout.trim();
const failures = [];
if (currentNodeMajor !== requiredNodeMajor) {
  failures.push(`Node.js ${requiredNodeMajor}.x is required, but ${process.versions.node} is active.`);
}
if (currentPnpmVersion !== requiredPnpmVersion) {
  failures.push(`pnpm ${requiredPnpmVersion} is required, but ${currentPnpmVersion} is active.`);
}

if (failures.length > 0) {
  console.error('Toolchain contract failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error('Use nvm use and Corepack before running project commands.');
  process.exit(1);
}

console.log(`Toolchain contract passed: Node ${process.versions.node}, pnpm ${currentPnpmVersion}.`);
