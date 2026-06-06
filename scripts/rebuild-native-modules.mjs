#!/usr/bin/env node
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { getElectronVersionForVSCode } from './get-electron-version.mjs';

/**
 * Rebuilds native modules (sqlite3, better-sqlite3) for Electron.
 * 
 * @remarks
 * This script is called:
 * 1. Automatically via postinstall hook after `pnpm install`
 * 2. Manually via `pnpm run rebuild:native`
 * 3. In CI during build process (scripts/build.mjs)
 * 
 * The Electron version is determined from package.json engines.vscode
 * and mapped via get-electron-version.mjs.
 */

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
const electronVersion = getElectronVersionForVSCode(packageJson.engines.vscode);

console.log(`[rebuild-native-modules] Rebuilding native modules for Electron ${electronVersion}...`);

try {
  // Rebuild sqlite3 (legacy CLI support)
  console.log('→ sqlite3');
  execSync('npm rebuild sqlite3', { stdio: 'inherit' });

  // Rebuild better-sqlite3 for Electron
  console.log('→ better-sqlite3');
  execSync(
    `npx electron-rebuild -v ${electronVersion} -m ./node_modules/better-sqlite3 -f`,
    { stdio: 'inherit' }
  );

  console.log('✓ Native modules rebuilt successfully');
} catch (error) {
  console.error('✗ Failed to rebuild native modules:', error.message);
  process.exit(1);
}
