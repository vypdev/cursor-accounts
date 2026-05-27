#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/prepare-bin-for-target.mjs <platform-arch>');
  process.exit(1);
}

const root = process.cwd();
const binDir = path.join(root, 'bin');
const backupDir = path.join(root, '.bin-all-backup');
const targetDir = path.join(binDir, target);
const binaryName = target.startsWith('win32-') ? 'sqlite3.exe' : 'sqlite3';
const sourceBinary = path.join(targetDir, binaryName);

if (!fs.existsSync(sourceBinary)) {
  console.error(`Missing bundled binary: ${sourceBinary}`);
  process.exit(1);
}

if (fs.existsSync(backupDir)) {
  fs.rmSync(backupDir, { recursive: true, force: true });
}

fs.renameSync(binDir, backupDir);
fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(path.join(backupDir, target, binaryName), sourceBinary);

if (!target.startsWith('win32-')) {
  fs.chmodSync(sourceBinary, 0o755);
}

console.log(`Prepared bin/${target}/${binaryName} for packaging`);
