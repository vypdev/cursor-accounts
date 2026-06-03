import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src', 'persistence', 'migrations');
const target = join(root, 'out', 'persistence', 'migrations');

mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true, force: true });

console.log(`Copied migrations to ${target}`);
