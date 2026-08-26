#!/usr/bin/env node
import { readdirSync, statSync } from 'fs';
import { basename, resolve } from 'path';
import { inspectVsixArtifact } from './vsixVerification.mjs';

const root = process.cwd();
const requestedVsix = process.env.VSIX_FILE;
const availableVsixFiles = readdirSync(root)
  .filter((file) => file.endsWith('.vsix'))
  .sort(
    (left, right) =>
      statSync(resolve(root, right)).mtimeMs -
      statSync(resolve(root, left)).mtimeMs
  );
const vsixFiles = requestedVsix
  ? [basename(requestedVsix)]
  : availableVsixFiles.slice(0, 1);

if (vsixFiles.length === 0) {
  console.error('No VSIX files found');
  process.exit(1);
}

if (!availableVsixFiles.includes(vsixFiles[0])) {
  console.error(`VSIX file not found: ${requestedVsix}`);
  process.exit(1);
}

function targetFromVsixName(vsix) {
  const match = vsix.match(
    /-(darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64|win32-arm64)-/
  );
  return match?.[1];
}

let allValid = true;

for (const vsix of vsixFiles) {
  console.log(`Checking ${vsix}…`);
  const target = targetFromVsixName(vsix);

  try {
    const inspection = inspectVsixArtifact(resolve(root, vsix), { target });

    for (const { label, present } of inspection.checks) {
      if (present) {
        console.log(`  ✓ ${label}`);
      } else {
        console.error(`  ✗ MISSING ${label}`);
        allValid = false;
      }
    }

    for (const { pattern, present } of inspection.forbidden) {
      if (present) {
        console.error(`  ✗ FORBIDDEN development artifact: ${String(pattern)}`);
        allValid = false;
      }
    }

    if (target) {
      if (inspection.nativeError) {
        console.error(
          `  ✗ INVALID better-sqlite3 native target (${inspection.nativeError.message})`
        );
        allValid = false;
      } else if (inspection.nativeTarget !== target) {
        console.error(
          `  ✗ INVALID better-sqlite3 native target (expected ${target}, got ${inspection.nativeTarget ?? 'unknown'})`
        );
        allValid = false;
      } else {
        console.log(`  ✓ better-sqlite3 native target (${target})`);
      }
    }
  } catch (error) {
    console.error(
      `  ✗ FAILED verification (${error instanceof Error ? error.message : String(error)})`
    );
    allValid = false;
  }
}

if (!allValid) {
  process.exit(1);
}

console.log(`\nAll ${vsixFiles.length} selected VSIX file(s) verified successfully!`);
