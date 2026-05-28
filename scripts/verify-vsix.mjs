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

for (const vsix of vsixFiles) {
  try {
    const result = execSync(
      `unzip -l "${vsix}" | grep "extension/webview-dist/bundle.js"`,
      {
        cwd: root,
        encoding: 'utf-8',
      }
    );

    if (result.includes('bundle.js')) {
      console.log(`✓ ${vsix} - contains webview bundle`);
    } else {
      console.error(`✗ ${vsix} - MISSING webview bundle`);
      allValid = false;
    }
  } catch {
    console.error(`✗ ${vsix} - MISSING webview bundle`);
    allValid = false;
  }
}

if (!allValid) {
  process.exit(1);
}

console.log(`\nAll ${vsixFiles.length} VSIX files verified successfully!`);
