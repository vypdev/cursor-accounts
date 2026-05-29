#!/usr/bin/env node
/**
 * Validates that all locale bundles share the same key set as en.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, '..', 'locales');

const enPath = path.join(localesDir, 'en.json');
const en = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
const enKeys = Object.keys(en).sort();

const localeFiles = fs
  .readdirSync(localesDir)
  .filter((file) => file.endsWith('.json') && file !== 'en.json');

let failed = false;

for (const file of localeFiles) {
  const localePath = path.join(localesDir, file);
  const bundle = JSON.parse(fs.readFileSync(localePath, 'utf-8'));
  const keys = Object.keys(bundle).sort();

  const missing = enKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !enKeys.includes(key));

  if (missing.length > 0 || extra.length > 0) {
    failed = true;
    console.error(`Locale ${file} key mismatch:`);
    if (missing.length > 0) {
      console.error(`  Missing (${missing.length}): ${missing.join(', ')}`);
    }
    if (extra.length > 0) {
      console.error(`  Extra (${extra.length}): ${extra.join(', ')}`);
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  `L10n validation passed: ${localeFiles.length + 1} locale(s), ${enKeys.length} keys each.`
);
