#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  renameSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAbi } from 'node-abi';
import { getElectronVersionForVSCode } from './get-electron-version.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const betterSqlitePath = path.join(root, 'node_modules', 'better-sqlite3');
const betterSqlitePackage = JSON.parse(
  readFileSync(path.join(betterSqlitePath, 'package.json'), 'utf8')
);
const buildPath = path.join(betterSqlitePath, 'build', 'Release');
const bindingPath = path.join(buildPath, 'better_sqlite3.node');
const electronVersion = getElectronVersionForVSCode(packageJson.engines.vscode);
const electronAbi = String(getAbi(electronVersion, 'electron'));
const version = betterSqlitePackage.version;
const platform = process.platform === 'win32' ? 'win32' : process.platform;
const architecture = process.arch;
const assetName = `better-sqlite3-v${version}-electron-v${electronAbi}-${platform}-${architecture}.tar.gz`;
const releaseApiUrl = `https://api.github.com/repos/WiseLibs/better-sqlite3/releases/tags/v${version}`;
const prebuildUrl = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${assetName}`;

async function resolveExpectedDigest() {
  const response = await fetch(releaseApiUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'cursor-accounts-native-build',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub release metadata request failed with HTTP ${response.status}`);
  }
  const release = await response.json();
  const asset = release.assets?.find((candidate) => candidate.name === assetName);
  if (!asset?.digest?.startsWith('sha256:')) {
    throw new Error(`Release asset has no SHA-256 digest: ${assetName}`);
  }
  return asset.digest;
}

function sha256(filePath) {
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

function findExtractedBinding(extractionRoot) {
  const expectedRelativePath = path.join('build', 'Release', 'better_sqlite3.node');
  const candidates = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entryPath.endsWith(expectedRelativePath)) {
        candidates.push(entryPath);
      }
    }
  };
  walk(extractionRoot);
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one extracted native binding, found ${candidates.length}`);
  }
  return candidates[0];
}

function validateArchiveEntries(entries) {
  const normalizedEntries = entries.map((entry) => entry.replace(/\\/g, '/')).filter(Boolean);
  const expectedEntry = 'build/Release/better_sqlite3.node';
  if (normalizedEntries.length !== 1 || normalizedEntries[0] !== expectedEntry) {
    throw new Error(
      `Unexpected prebuild archive contents; expected only ${expectedEntry}`
    );
  }
}

async function main() {
  if (!existsSync(path.join(betterSqlitePath, 'package.json'))) {
    throw new Error(`better-sqlite3 package not found: ${betterSqlitePath}`);
  }

  // Never allow a binding from a previous target or failed attempt to satisfy
  // the post-download existence check.
  rmSync(bindingPath, { force: true });
  const expectedDigest = await resolveExpectedDigest();
  const tempRoot = mkdtempSync(path.join(root, '.tmp', 'electron-prebuild-'));
  const archivePath = path.join(tempRoot, assetName);
  const extractionRoot = path.join(tempRoot, 'extracted');
  mkdirSync(extractionRoot, { recursive: true });

  try {
    console.log(`[download-electron-prebuild] Electron ${electronVersion} / ABI ${electronAbi}`);
    console.log(`[download-electron-prebuild] Downloading ${assetName}`);
    execFileSync(
      'curl',
      [
        '--fail',
        '--show-error',
        '--silent',
        '--location',
        '--retry',
        '3',
        '--connect-timeout',
        '20',
        '--output',
        archivePath,
        prebuildUrl,
      ],
      { stdio: 'inherit' }
    );

    const actualDigest = sha256(archivePath);
    if (actualDigest !== expectedDigest) {
      throw new Error(`Prebuild checksum mismatch: expected ${expectedDigest}, got ${actualDigest}`);
    }

    const archiveEntries = execFileSync('tar', ['-tzf', archivePath], {
      encoding: 'utf8',
    }).split('\n');
    validateArchiveEntries(archiveEntries);
    execFileSync('tar', ['-xzf', archivePath, '-C', extractionRoot, '--no-same-owner'], {
      stdio: 'inherit',
    });
    const extractedBinding = findExtractedBinding(extractionRoot);
    mkdirSync(buildPath, { recursive: true });
    renameSync(extractedBinding, bindingPath);

    if (!existsSync(bindingPath)) {
      throw new Error(`Prebuild was verified but binding was not installed: ${bindingPath}`);
    }
    console.log(`[download-electron-prebuild] ✓ Installed verified binding at ${bindingPath}`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[download-electron-prebuild] ✗ Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

export { findExtractedBinding, sha256, validateArchiveEntries };
