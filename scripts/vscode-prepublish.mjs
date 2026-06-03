#!/usr/bin/env node
import { execSync } from 'child_process';

if (process.env.SKIP_PREPUBLISH === '1') {
  process.exit(0);
}

execSync('pnpm run bundle', { stdio: 'inherit' });
