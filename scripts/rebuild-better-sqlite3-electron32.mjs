#!/usr/bin/env node
import { execSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const betterSqlitePath = path.join(root, 'node_modules/better-sqlite3');
const buildPath = path.join(betterSqlitePath, 'build');
const prebuildsPath = path.join(betterSqlitePath, 'prebuilds');

console.log('[rebuild-electron32] Starting clean rebuild for Electron 32.0.0...');
console.log('[rebuild-electron32] better-sqlite3 path:', betterSqlitePath);

// Step 1: Remove existing builds and prebuilds
console.log('[rebuild-electron32] Step 1: Removing old builds...');
if (existsSync(buildPath)) {
  rmSync(buildPath, { recursive: true, force: true });
  console.log('[rebuild-electron32] Removed:', buildPath);
}
if (existsSync(prebuildsPath)) {
  rmSync(prebuildsPath, { recursive: true, force: true });
  console.log('[rebuild-electron32] Removed:', prebuildsPath);
}

// Step 2: Set environment variables to force source build
const env = {
  ...process.env,
  npm_config_build_from_source: 'true',
  npm_config_target: '32.0.0',
  npm_config_runtime: 'electron',
  npm_config_disturl: 'https://electronjs.org/headers',
  npm_config_arch: process.arch,
};

console.log('[rebuild-electron32] Step 2: Environment configured:');
console.log('  - build_from_source: true');
console.log('  - target: 32.0.0 (Electron)');
console.log('  - runtime: electron');
console.log('  - arch:', process.arch);

// Step 3: Run node-gyp rebuild
console.log('[rebuild-electron32] Step 3: Running node-gyp rebuild...');
try {
  execSync(
    'npx node-gyp rebuild --target=32.0.0 --arch=' + process.arch + ' --dist-url=https://electronjs.org/headers',
    {
      cwd: betterSqlitePath,
      stdio: 'inherit',
      env,
    }
  );
  console.log('[rebuild-electron32] ✓ Rebuild complete!');
  console.log('[rebuild-electron32] Binary location:', path.join(buildPath, 'Release/better_sqlite3.node'));
} catch (error) {
  console.error('[rebuild-electron32] ✗ Rebuild failed:', error.message);
  process.exit(1);
}
