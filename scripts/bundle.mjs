#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const production = process.env.NODE_ENV === 'production';

function run(cmd, options = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...options });
}

console.log('Building extension bundle...\n');

// Step 1: Build types package
console.log('1. Building @cursor-accounts/types...');
run('pnpm --dir packages/types run build');

// Step 2: Build webview
console.log('\n2. Building webview...');
run('pnpm --dir webview run build');

// Step 3: Compile TypeScript (for type checking and test compatibility)
console.log('\n3. Compiling TypeScript...');
run('tsc -p ./');

// Step 4: Bundle extension code with esbuild
console.log('\n4. Bundling extension with esbuild...');

try {
  await esbuild.build({
    entryPoints: ['./src/extension.ts'],
    bundle: true,
    outfile: './out/extension-bundle.js',
    external: [
      'vscode',
      '@cursor/sdk',
      '@cursor/sdk-*',
    ],
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    sourcemap: production ? false : 'inline',
    minify: production,
    logLevel: 'info',
    metafile: false,
  });

  console.log('\n✓ Bundle created successfully: out/extension-bundle.js');

  // Show bundle size
  const stats = fs.statSync('./out/extension-bundle.js');
  console.log(`  Size: ${(stats.size / 1024).toFixed(1)} KB`);

} catch (error) {
  console.error('Bundle failed:', error);
  process.exit(1);
}
