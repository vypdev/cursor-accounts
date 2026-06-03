#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

const PLATFORM_SDK_PACKAGE = {
  'darwin-arm64': '@cursor/sdk-darwin-arm64',
  'darwin-x64': '@cursor/sdk-darwin-x64',
  'linux-x64': '@cursor/sdk-linux-x64',
  'linux-arm64': '@cursor/sdk-linux-arm64',
  'win32-x64': '@cursor/sdk-win32-x64',
  'win32-arm64': '@cursor/sdk-win32-x64',
};

function installPlatformPackage(root, sdkPackage, version) {
  const scopedName = sdkPackage.split('/')[1];
  const destination = path.join(root, 'node_modules', '@cursor', scopedName);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-sdk-'));

  try {
    const tarballName = execSync(`npm pack ${sdkPackage}@${version} --pack-destination "${tempDir}"`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    const tarballPath = path.join(tempDir, tarballName);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(destination, { recursive: true });
    execSync(`tar -xzf "${tarballPath}" -C "${destination}" --strip-components=1`, {
      cwd: root,
      stdio: 'inherit',
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function prepareSdkForTarget(target) {
  const sdkPackage = PLATFORM_SDK_PACKAGE[target];
  if (!sdkPackage) {
    throw new Error(`Unknown SDK target: ${target}`);
  }

  const root = process.cwd();
  const cursorDir = path.join(root, 'node_modules', '@cursor');
  const sdkRootPackagePath = path.join(cursorDir, 'sdk', 'package.json');
  const sdkVersion = JSON.parse(fs.readFileSync(sdkRootPackagePath, 'utf8')).version;
  const scopedName = sdkPackage.split('/')[1];

  for (const entry of fs.readdirSync(cursorDir)) {
    if (entry.startsWith('sdk-') && entry !== scopedName) {
      fs.rmSync(path.join(cursorDir, entry), { recursive: true, force: true });
    }
  }

  const platformPackagePath = path.join(cursorDir, scopedName, 'package.json');
  if (!fs.existsSync(platformPackagePath)) {
    installPlatformPackage(root, sdkPackage, sdkVersion);
  }

  if (!fs.existsSync(platformPackagePath)) {
    throw new Error(`Missing SDK platform package after install: ${sdkPackage}`);
  }

  console.log(`Prepared ${sdkPackage} for ${target}`);
}
