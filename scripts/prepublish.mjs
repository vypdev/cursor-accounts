#!/usr/bin/env node
import { execSync } from 'child_process';

if (process.env.SKIP_PREPUBLISH === '1') {
  console.log('Skipping prepublish (already compiled)');
  process.exit(0);
}

execSync('pnpm run compile', { stdio: 'inherit' });
