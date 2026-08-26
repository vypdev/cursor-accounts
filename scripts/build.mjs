#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { cleanProductionDeps } from './clean-production-deps.mjs';
import { prepareSdkForTarget } from './prepare-sdk-for-target.mjs';
import { sanitizeVsix } from './sanitize-vsix.mjs';
import { convertToProduction, restoreState, saveState } from './workspace-state.mjs';
import { parseBuildArgs } from './build-targets.mjs';
import {
  assertVsixArtifact,
  inspectVsixArtifact,
} from './vsixVerification.mjs';

const root = process.cwd();
const ZIP_MAX_BUFFER = 16 * 1024 * 1024;

function run(command, options = {}) {
  execSync(command, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  });
}

function ensureNodeVersion() {
  if (process.platform === 'win32') {
    const major = Number.parseInt(process.versions.node.split('.')[0], 10);
    if (major !== 24) {
      throw new Error(`Node.js 24.x required. Current version: v${process.versions.node}`);
    }
  } else {
    run('bash scripts/ensure-node.sh', { shell: true });
  }

  run('pnpm run verify:toolchain');
}

function bundleExtension() {
  console.log('\n==> Bundling extension, webview, and workspace packages');
  run('pnpm run bundle');
}

async function preparePackage() {
  console.log('\n==> Preparing production dependencies');
  run('pnpm install --frozen-lockfile', {
    env: { ...process.env, CI: 'true' },
  });

  const cursorDir = path.join(root, 'node_modules', '@cursor');
  if (!fs.existsSync(path.join(cursorDir, 'sdk', 'package.json'))) {
    throw new Error('Missing @cursor/sdk package in node_modules');
  }

  const sdkPackages = fs
    .readdirSync(cursorDir)
    .filter((entry) => entry.startsWith('sdk-'))
    .map((entry) => `@cursor/${entry}`);

  console.log(
    sdkPackages.length > 0
      ? `Found SDK packages: ${sdkPackages.join(', ')}`
      : 'Platform SDK packages will be installed per target during packaging'
  );
}

function packageTarget(target) {
  console.log(`\n==> Packaging ${target}`);

  prepareSdkForTarget(target);
  run(`node scripts/download-electron-prebuild.mjs ${target}`);
  run(`node scripts/prepare-bin-for-target.mjs ${target}`);

  const vsceArgs = [
    'pnpm exec vsce package',
    `--target ${target}`,
    '--allow-missing-repository',
    '--allow-star-activation',
    '--dependencies',
    '--follow-symlinks',
    '--no-rewrite-relative-links',
  ].join(' ');

  const shimDirectory = path.join(root, '.tmp', 'vsce-bin');
  const shimName = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const shimPath = path.join(shimDirectory, shimName);
  fs.mkdirSync(shimDirectory, { recursive: true });
  if (process.platform === 'win32') {
    fs.writeFileSync(
      shimPath,
      `@node "${path.join(root, 'scripts', 'vsce-pnpm-npm-shim.mjs')}" %*\r\n`
    );
  } else {
    fs.copyFileSync(
      path.join(root, 'scripts', 'vsce-pnpm-npm-shim.mjs'),
      shimPath
    );
    fs.chmodSync(shimPath, 0o755);
  }
  const realNpm = process.platform === 'win32' ? 'npm.cmd' : execSync('command -v npm', { encoding: 'utf8' }).trim();

  run(`${vsceArgs}`, {
    env: {
      ...process.env,
      PATH: `${shimDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
      VSCE_REAL_NPM: realNpm,
      SKIP_PREPUBLISH: '1',
    },
  });

  run('node scripts/restore-bin.mjs');
  const version = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  ).version;
  sanitizeVsix(
    path.join(root, `cursor-accounts-${target}-${version}.vsix`)
  );
}

function verifyVsix(target) {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const vsixName = `cursor-accounts-${target}-${version}.vsix`;
  const vsixPath = path.join(root, vsixName);

  if (!fs.existsSync(vsixPath)) {
    throw new Error(`Expected VSIX not found: ${vsixName}`);
  }

  console.log(`\n==> Verifying ${vsixName}`);
  const inspection = inspectVsixArtifact(vsixPath, {
    target,
    includeMigrations: true,
  });
  assertVsixArtifact(inspection, { target });
  for (const { label } of inspection.checks) {
    console.log(`  ✓ ${label}`);
  }
  console.log(`  ✓ better-sqlite3 native target (${target})`);
}

async function main() {
  const args = parseBuildArgs(process.argv.slice(2));
  let packagingPrepared = false;

  try {
    ensureNodeVersion();
    bundleExtension();
    await preparePackage();

    saveState();
    packagingPrepared = true;
    convertToProduction();
    cleanProductionDeps();

    for (const target of args.targets) {
      packageTarget(target);
      verifyVsix(target);
    }

    console.log(`\nBuild complete (${args.targets.length} VSIX${args.targets.length === 1 ? '' : 'es'})`);
  } finally {
    run('node scripts/restore-bin.mjs', { stdio: 'ignore' });
    if (packagingPrepared) {
      restoreState();
    }
  }
}

main().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
