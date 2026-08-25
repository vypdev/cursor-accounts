#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  findExtractedBinding,
  sha256,
  validateArchiveEntries,
} from './download-electron-prebuild.mjs';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cursor-accounts-prebuild-test-'));

try {
  const bindingDirectory = path.join(tempRoot, 'build', 'Release');
  mkdirSync(bindingDirectory, { recursive: true });
  const bindingPath = path.join(bindingDirectory, 'better_sqlite3.node');
  writeFileSync(bindingPath, 'verified-native-binding');

  assert.equal(findExtractedBinding(tempRoot), bindingPath);
  assert.match(sha256(bindingPath), /^sha256:[a-f0-9]{64}$/);
  validateArchiveEntries(['build/Release/better_sqlite3.node', '']);
  assert.throws(
    () => validateArchiveEntries(['build/Release/better_sqlite3.node', '../escape.txt']),
    /Unexpected prebuild archive contents/
  );
  assert.throws(
    () => validateArchiveEntries(['../../escape.node']),
    /Unexpected prebuild archive contents/
  );
  assert.throws(
    () => findExtractedBinding(path.join(tempRoot, 'missing')),
    /ENOENT/
  );
  console.log('Electron prebuild helper tests passed.');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
