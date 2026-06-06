#!/usr/bin/env node
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const betterSqlitePath = path.join(root, 'node_modules/better-sqlite3');
const buildPath = path.join(betterSqlitePath, 'build/Release');
const bindingPath = path.join(buildPath, 'better_sqlite3.node');

// Electron version 39 = ABI 140
const ELECTRON_ABI = '140';
const VERSION = '12.9.0';
const PLATFORM = process.platform === 'darwin' ? 'darwin' : process.platform;
const ARCH = process.arch;

const prebuildUrl = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${VERSION}/better-sqlite3-v${VERSION}-electron-v${ELECTRON_ABI}-${PLATFORM}-${ARCH}.tar.gz`;

console.log(`[download-electron-prebuild] Downloading prebuild for Electron ABI ${ELECTRON_ABI}...`);
console.log(`[download-electron-prebuild] URL: ${prebuildUrl}`);
console.log(`[download-electron-prebuild] Target: ${bindingPath}`);

try {
  // Create build directory if it doesn't exist
  if (!existsSync(buildPath)) {
    mkdirSync(buildPath, { recursive: true });
  }

  // Download and extract prebuild
  execSync(
    `curl -L "${prebuildUrl}" | tar -xz -C "${betterSqlitePath}"`,
    { stdio: 'inherit' }
  );

  if (existsSync(bindingPath)) {
    console.log(`[download-electron-prebuild] ✓ Successfully installed Electron ${ELECTRON_ABI} prebuild`);
  } else {
    throw new Error('Prebuild was downloaded but binding file not found');
  }
} catch (error) {
  console.error(`[download-electron-prebuild] ✗ Failed:`, error.message);
  process.exit(1);
}
