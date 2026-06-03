#!/usr/bin/env node
import { execSync } from 'child_process';
import { readdirSync } from 'fs';

const root = process.cwd();
const vsixFiles = readdirSync(root).filter((f) => f.endsWith('.vsix'));

if (vsixFiles.length === 0) {
  console.error('No VSIX files found');
  process.exit(1);
}

let allValid = true;

const PLATFORM_SDK_PACKAGE = {
  'darwin-arm64': '@cursor/sdk-darwin-arm64',
  'darwin-x64': '@cursor/sdk-darwin-x64',
  'linux-x64': '@cursor/sdk-linux-x64',
  'linux-arm64': '@cursor/sdk-linux-arm64',
  'win32-x64': '@cursor/sdk-win32-x64',
  'win32-arm64': '@cursor/sdk-win32-x64',
};

function targetFromVsixName(vsix) {
  const match = vsix.match(
    /-(darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64|win32-arm64)-/
  );
  return match?.[1];
}

for (const vsix of vsixFiles) {
  console.log(`Checking ${vsix}…`);
  const target = targetFromVsixName(vsix);

  const checks = [
    { label: 'webview bundle', pattern: 'extension/webview-dist/bundle.js' },
    {
      label: 'sqlite3 native binding',
      pattern: 'extension/node_modules/sqlite3/build/Release/node_sqlite3.node',
    },
    {
      label: '@cursor/sdk',
      pattern: 'extension/node_modules/@cursor/sdk/package.json',
    },
    { label: 'undici', pattern: 'extension/node_modules/undici/package.json' },
    { label: 'bindings', pattern: 'extension/node_modules/bindings/package.json' },
  ];

  if (target && PLATFORM_SDK_PACKAGE[target]) {
    checks.push({
      label: `@cursor/sdk platform package (${target})`,
      pattern: `extension/node_modules/${PLATFORM_SDK_PACKAGE[target]}/package.json`,
    });
  }

  for (const { label, pattern } of checks) {
    try {
      execSync(`unzip -l "${vsix}" | grep "${pattern}"`, {
        cwd: root,
        encoding: 'utf-8',
      });
      console.log(`  ✓ ${label}`);
    } catch {
      console.error(`  ✗ MISSING ${label}`);
      allValid = false;
    }
  }
}

if (!allValid) {
  process.exit(1);
}

console.log(`\nAll ${vsixFiles.length} VSIX files verified successfully!`);
