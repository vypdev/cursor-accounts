#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(root, '..');
const source = path.join(projectRoot, 'hooks', 'capture-prompt.js');
const targetDir = path.join(projectRoot, 'out', 'hooks');
const target = path.join(targetDir, 'capture-prompt.js');

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
fs.chmodSync(target, 0o755);
console.log(`Copied hook to ${target}`);
