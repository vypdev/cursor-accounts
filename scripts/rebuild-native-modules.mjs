#!/usr/bin/env node
import { execSync } from 'child_process';
import { mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { getElectronVersionForVSCode } from './get-electron-version.mjs';

/**
 * Rebuild native modules for an explicit runtime.
 *
 * The same workspace can be used by Node-based tests and by the VS Code
 * Extension Host. Those runtimes use different native-module ABIs, so a
 * single implicit rebuild target is unsafe.
 */

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
const electronVersion = getElectronVersionForVSCode(packageJson.engines.vscode);
const nativeCacheDir = path.resolve('.tmp', 'native-build');
mkdirSync(nativeCacheDir, { recursive: true });
const rebuildOptions = {
  stdio: 'inherit',
  env: {
    ...process.env,
    npm_config_cache: path.join(nativeCacheDir, 'npm-cache'),
    npm_config_devdir: path.join(nativeCacheDir, 'node-gyp'),
  },
};
const runtime = process.argv.includes('--runtime')
  ? process.argv[process.argv.indexOf('--runtime') + 1]
  : 'electron';

if (runtime !== 'node' && runtime !== 'electron') {
  console.error(`Unsupported runtime "${runtime}". Use --runtime node or --runtime electron.`);
  process.exit(1);
}

console.log(`[rebuild-native-modules] Rebuilding native modules for ${runtime}...`);

try {
  if (runtime === 'node') {
    console.log('→ better-sqlite3 (Node ABI)');
    execSync('npm rebuild better-sqlite3', rebuildOptions);
  } else {
    console.log(`→ better-sqlite3 (Electron ${electronVersion})`);
    execSync(
      `npx electron-rebuild -v ${electronVersion} -m ./node_modules/better-sqlite3 -f`,
      rebuildOptions
    );
  }

  console.log(`✓ Native modules rebuilt successfully for ${runtime}`);
} catch (error) {
  console.error('✗ Failed to rebuild native modules:', error.message);
  process.exit(1);
}
