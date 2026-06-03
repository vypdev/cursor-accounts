import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'proto');
const target = join(root, 'out', 'proto');

mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true, force: true });

console.log(`Copied protos to ${target}`);
