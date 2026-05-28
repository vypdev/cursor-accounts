#!/usr/bin/env node
/**
 * Verifies which cursor-quota extension build Cursor has installed locally.
 * Install path: ~/.cursor/extensions/vypdev.cursor-quota-<version>/
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const BUILD_MARKERS = [
  'cursorQuota.accountsPanel',
  'retainContextWhenHidden',
  'registerWebviewViewProvider',
];

const extRoot = join(homedir(), '.cursor', 'extensions');
const packageJsonPath = join(process.cwd(), 'package.json');
const expectedVersion = existsSync(packageJsonPath)
  ? JSON.parse(readFileSync(packageJsonPath, 'utf-8')).version
  : undefined;

console.log('=== Cursor Quota — installed extension verification ===\n');
console.log(`Expected workspace version: ${expectedVersion ?? 'unknown'}`);
console.log(`Cursor extensions directory: ${extRoot}\n`);

if (!existsSync(extRoot)) {
  console.error('Extensions directory not found. Is Cursor installed?');
  process.exit(1);
}

const installed = readdirSync(extRoot)
  .filter((name) => name.startsWith('vypdev.cursor-quota'))
  .sort();

if (installed.length === 0) {
  console.error('No vypdev.cursor-quota extension found in ~/.cursor/extensions/');
  console.error('\nReinstall steps:');
  printReinstallSteps(expectedVersion);
  process.exit(1);
}

let foundExpected = false;

for (const folder of installed) {
  const extensionJs = join(extRoot, folder, 'out', 'extension.js');
  const accountsPanelJs = join(extRoot, folder, 'out', 'ui', 'accountsPanel.js');
  const pkgPath = join(extRoot, folder, 'package.json');

  console.log(`--- ${folder} ---`);

  if (!existsSync(extensionJs)) {
    console.log('  extension.js: MISSING');
    continue;
  }

  const source = [
    readFileSync(extensionJs, 'utf-8'),
    existsSync(accountsPanelJs) ? readFileSync(accountsPanelJs, 'utf-8') : '',
  ].join('\n');

  const installedVersion = existsSync(pkgPath)
    ? JSON.parse(readFileSync(pkgPath, 'utf-8')).version
    : 'unknown';

  console.log(`  package.json version: ${installedVersion}`);
  console.log(`  extension.js size: ${readFileSync(extensionJs, 'utf-8').length} bytes`);

  for (const marker of BUILD_MARKERS) {
    const found = source.includes(marker);
    console.log(`  marker "${marker}": ${found ? 'YES' : 'no'}`);
  }

  if (expectedVersion && installedVersion === expectedVersion) {
    foundExpected = true;
  }

  console.log('');
}

if (expectedVersion && !foundExpected) {
  console.error(
    `Expected version ${expectedVersion} is NOT installed (found: ${installed.join(', ')})`
  );
  console.error('\nReinstall steps:');
  printReinstallSteps(expectedVersion);
  process.exit(1);
}

console.log('Installed extension matches expected workspace version.');
process.exit(0);

function printReinstallSteps(version) {
  const vsix = `cursor-quota-darwin-arm64-${version}.vsix`;
  console.log(`  1. Extensions view → uninstall all "Cursor Quota" versions`);
  console.log(`  2. Quit Cursor completely (Cmd+Q)`);
  console.log(`  3. Optional: remove stale folders from ~/.cursor/extensions/vypdev.cursor-quota-*`);
  console.log(`  4. Restart Cursor`);
  console.log(`  5. Install from VSIX: ${vsix}`);
  console.log(`  6. Developer: Reload Window`);
  console.log(`  7. Open the Cursor Quota sidebar (profile icon) or run "Cursor Quota: Open Accounts Panel"`);
}
