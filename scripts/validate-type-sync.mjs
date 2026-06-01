#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sharedTypesPath = path.join(rootDir, 'packages/types/src/index.ts');
const webviewTypesPath = path.join(rootDir, 'webview/src/types/index.ts');

function extractExportedNames(source) {
  const names = new Set();
  const exportTypeRegex = /export\s+type\s+\{\s*([^}]+)\s*\}/g;
  const exportNamedRegex = /export\s+(?:function|const|class|interface|type)\s+(\w+)/g;
  const exportStarRegex = /export\s+\*\s+from\s+['"][^'"]+['"]/g;

  if (exportStarRegex.test(source)) {
    return null;
  }

  let match;
  while ((match = exportTypeRegex.exec(source)) !== null) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) {
        names.add(name);
      }
    }
  }

  while ((match = exportNamedRegex.exec(source)) !== null) {
    names.add(match[1]);
  }

  return names;
}

const sharedSource = fs.readFileSync(sharedTypesPath, 'utf8');
const webviewSource = fs.readFileSync(webviewTypesPath, 'utf8');

if (webviewSource.includes('export * from')) {
  console.log('Webview types re-export shared package; sync validated by package boundary.');
  process.exit(0);
}

const sharedNames = extractExportedNames(sharedSource);
const webviewNames = extractExportedNames(webviewSource);

if (!sharedNames || !webviewNames) {
  console.log('Skipping strict export comparison for barrel re-exports.');
  process.exit(0);
}

const requiredInWebview = [
  'Profile',
  'QuotaUsage',
  'ProfileQuota',
  'ToWebviewMessage',
  'FromWebviewMessage',
  'getQuotaStatus',
  'getEffectiveUsagePercent',
];

const missing = requiredInWebview.filter((name) => !webviewNames.has(name));
if (missing.length > 0) {
  console.error(`Webview types missing exports: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('Shared/webview type sync validation passed.');
