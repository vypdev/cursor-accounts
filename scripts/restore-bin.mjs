#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const binDir = path.join(root, 'bin');
const backupDir = path.join(root, '.bin-all-backup');

if (!fs.existsSync(backupDir)) {
  process.exit(0);
}

if (fs.existsSync(binDir)) {
  fs.rmSync(binDir, { recursive: true, force: true });
}

fs.renameSync(backupDir, binDir);
console.log('Restored full bin/ directory');
