#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { cleanProductionDeps } from './clean-production-deps.mjs';
import { prepareSdkForTarget } from './prepare-sdk-for-target.mjs';
import { sanitizeVsix } from './sanitize-vsix.mjs';
import { convertToProduction, restoreState, saveState } from './workspace-state.mjs';

const ALL_TARGETS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-x64',
  'linux-arm64',
  'win32-x64',
  'win32-arm64',
];

const PLATFORM_SDK_PACKAGE = {
  'darwin-arm64': '@cursor/sdk-darwin-arm64',
  'darwin-x64': '@cursor/sdk-darwin-x64',
  'linux-x64': '@cursor/sdk-linux-x64',
  'linux-arm64': '@cursor/sdk-linux-arm64',
  'win32-x64': '@cursor/sdk-win32-x64',
  'win32-arm64': '@cursor/sdk-win32-x64',
};

const root = process.cwd();

function run(command, options = {}) {
  execSync(command, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  });
}

function parseArgs(argv) {
  const args = {
    all: false,
    current: false,
    targets: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--all') {
      args.all = true;
      continue;
    }

    if (arg === '--current') {
      args.current = true;
      continue;
    }

    if (arg === '--target') {
      const target = argv[index + 1];
      if (!target || !ALL_TARGETS.includes(target)) {
        throw new Error(`Invalid target "${target ?? ''}". Expected one of: ${ALL_TARGETS.join(', ')}`);
      }
      args.targets.push(target);
      index += 1;
      continue;
    }

    if (ALL_TARGETS.includes(arg)) {
      args.targets.push(arg);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.all) {
    args.targets = [...ALL_TARGETS];
  } else if (args.current) {
    args.targets = [`${process.platform}-${process.arch}`];
  } else if (args.targets.length === 0) {
    args.targets = [`${process.platform}-${process.arch}`];
  }

  return args;
}

function ensureNodeVersion() {
  if (process.platform === 'win32') {
    const major = Number.parseInt(process.versions.node.split('.')[0], 10);
    if (major < 22) {
      throw new Error(`Node.js 22+ required. Current version: v${process.versions.node}`);
    }
    return;
  }

  run('bash scripts/ensure-node.sh', { shell: true });
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

  console.log('Building sqlite3 native binding…');
  run('npm rebuild sqlite3');

  // Download better-sqlite3 prebuild for Electron (directly from GitHub releases)
  console.log('Downloading better-sqlite3 prebuild for Electron…');
  run('node scripts/download-electron-prebuild.mjs');

  const cursorDir = path.join(root, 'node_modules', '@cursor');
  if (!fs.existsSync(path.join(cursorDir, 'sdk', 'package.json'))) {
    throw new Error('Missing @cursor/sdk package in node_modules');
  }

  const sdkPackages = fs
    .readdirSync(cursorDir)
    .filter((entry) => entry.startsWith('sdk-'))
    .map((entry) => `@cursor/${entry}`);

  const sqliteBinding = path.join(
    root,
    'node_modules',
    'sqlite3',
    'build',
    'Release',
    'node_sqlite3.node'
  );

  const betterSqliteBinding = path.join(
    root,
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  );

  if (!fs.existsSync(sqliteBinding)) {
    throw new Error(`Missing sqlite3 native binding: ${sqliteBinding}`);
  }

  if (!fs.existsSync(betterSqliteBinding)) {
    throw new Error(`Missing better-sqlite3 native binding: ${betterSqliteBinding}`);
  }

  console.log(
    sdkPackages.length > 0
      ? `Found SDK packages: ${sdkPackages.join(', ')}`
      : 'Platform SDK packages will be installed per target during packaging'
  );
  console.log(`Found sqlite3 binding: ${sqliteBinding}`);
  console.log(`Found better-sqlite3 binding: ${betterSqliteBinding}`);
}

function packageTarget(target) {
  console.log(`\n==> Packaging ${target}`);

  prepareSdkForTarget(target);
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

  const checks = [
    { label: 'webview bundle', pattern: 'extension/webview-dist/bundle.js' },
    {
      label: 'sqlite3 native binding',
      pattern: 'extension/node_modules/sqlite3/build/Release/node_sqlite3.node',
    },
    {
      label: 'better-sqlite3 native binding',
      pattern: 'extension/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    },
    {
      label: '@cursor/sdk',
      pattern: 'extension/node_modules/@cursor/sdk/package.json',
    },
    {
      label: 'undici',
      pattern: 'extension/node_modules/.pnpm/undici@.*/node_modules/undici/package.json',
    },
    {
      label: 'bindings',
      pattern: 'extension/node_modules/.pnpm/bindings@.*/node_modules/bindings/package.json',
    },
    {
      label: 'efficiency SQL migrations',
      pattern: 'extension/out/persistence/migrations/001_initial_schema.sql',
    },
  ];

  const forbiddenPatterns = [
    'extension/.repowise/',
    'extension/graphify-out/',
    'extension/coverage/',
    'extension/webview/src/',
    'extension/webview/node_modules/',
    'extension/.build-backup/',
    'extension/.tmp-proto-test/',
    'extension/packages/',
    'extension/docs/',
    'extension/scripts/',
  ];
  const forbiddenRegexPatterns = [
    'extension/node_modules/.*/(docs|coverage|tests?|scripts|gyp|testdata)/',
  ];

  const sdkPackage = PLATFORM_SDK_PACKAGE[target];
  if (sdkPackage) {
    checks.push({
      label: `@cursor/sdk platform package (${target})`,
      pattern: `extension/node_modules/${sdkPackage}/package.json`,
    });
  }

  console.log(`\n==> Verifying ${vsixName}`);
  for (const { label, pattern } of checks) {
    try {
      execSync(`unzip -l "${vsixPath}" | grep "${pattern}"`, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      console.log(`  ✓ ${label}`);
    } catch {
      throw new Error(`VSIX verification failed: missing ${label}`);
    }
  }

  for (const pattern of forbiddenPatterns) {
    try {
      execSync(`unzip -l "${vsixPath}" | grep -F "${pattern}"`, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      throw new Error(`VSIX verification failed: forbidden artifact ${pattern}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('VSIX verification failed:')) {
        throw error;
      }
      // The forbidden pattern was not found.
    }
  }

  for (const pattern of forbiddenRegexPatterns) {
    try {
      execSync(`unzip -l "${vsixPath}" | grep -E "${pattern}"`, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      throw new Error(`VSIX verification failed: forbidden artifact ${pattern}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('VSIX verification failed:')) {
        throw error;
      }
      // The forbidden pattern was not found.
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
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
