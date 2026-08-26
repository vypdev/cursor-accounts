#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  findExtractedBinding,
  parseTarget,
  sha256,
  validateArchiveEntries,
} from './download-electron-prebuild.mjs';
import { detectNativeTarget } from './native-binary-target.mjs';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cursor-accounts-prebuild-test-'));

try {
  const bindingDirectory = path.join(tempRoot, 'build', 'Release');
  mkdirSync(bindingDirectory, { recursive: true });
  const bindingPath = path.join(bindingDirectory, 'better_sqlite3.node');
  writeFileSync(bindingPath, 'verified-native-binding');

  assert.equal(findExtractedBinding(tempRoot), bindingPath);
  assert.match(sha256(bindingPath), /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(parseTarget('linux-arm64'), {
    target: 'linux-arm64',
    platform: 'linux',
    architecture: 'arm64',
  });
  assert.deepEqual(parseTarget('win32-x64'), {
    target: 'win32-x64',
    platform: 'win32',
    architecture: 'x64',
  });
  assert.throws(
    () => parseTarget('linux-ia32'),
    /Unsupported native target "linux-ia32"/
  );
  const darwinArm64Header = Buffer.alloc(8);
  darwinArm64Header.writeUInt32LE(0xfeedfacf, 0);
  darwinArm64Header.writeUInt32LE(0x0100000c, 4);
  assert.equal(detectNativeTarget(darwinArm64Header), 'darwin-arm64');

  const linuxX64Header = Buffer.alloc(20, 0);
  linuxX64Header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1], 0);
  linuxX64Header.writeUInt16LE(0x3e, 18);
  assert.equal(detectNativeTarget(linuxX64Header), 'linux-x64');

  const windowsArm64Header = Buffer.alloc(140, 0);
  windowsArm64Header.set([0x4d, 0x5a], 0);
  windowsArm64Header.writeUInt32LE(128, 0x3c);
  windowsArm64Header.set([0x50, 0x45, 0x00, 0x00], 128);
  windowsArm64Header.writeUInt16LE(0xaa64, 132);
  assert.equal(detectNativeTarget(windowsArm64Header), 'win32-arm64');

  assert.throws(
    () => detectNativeTarget(Buffer.from('not-a-native-binary')),
    /Unsupported native binary format/
  );
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
