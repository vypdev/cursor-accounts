#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const root = process.cwd();
const backupDir = path.join(root, '.build-backup');
const packageBackupPath = path.join(backupDir, 'package.json');
const typesPackagePath = path.join(root, 'packages', 'types');
const typesNodeModulesPath = path.join(root, 'node_modules', '@cursor-accounts', 'types');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

export function saveState() {
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), packageBackupPath);
}

export function convertToProduction() {
  const rootPackage = readJson(path.join(root, 'package.json'));
  const typesPackage = readJson(path.join(typesPackagePath, 'package.json'));

  if (!fs.existsSync(path.join(typesPackagePath, 'dist', 'index.js'))) {
    throw new Error('Missing compiled types package. Run compile before packaging.');
  }

  if (fs.existsSync(typesNodeModulesPath)) {
    fs.rmSync(typesNodeModulesPath, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(typesNodeModulesPath), { recursive: true });
  copyDirectory(typesPackagePath, typesNodeModulesPath);

  const productionTypesPackage = readJson(path.join(typesNodeModulesPath, 'package.json'));
  delete productionTypesPackage.devDependencies;
  writeJson(path.join(typesNodeModulesPath, 'package.json'), productionTypesPackage);

  const workspaceTypes = rootPackage.dependencies?.['@cursor-accounts/types'];
  if (workspaceTypes?.startsWith('workspace:')) {
    rootPackage.dependencies['@cursor-accounts/types'] = typesPackage.version;
    writeJson(path.join(root, 'package.json'), rootPackage);
  }
}

export function restoreState() {
  if (!fs.existsSync(packageBackupPath)) {
    return;
  }

  fs.copyFileSync(packageBackupPath, path.join(root, 'package.json'));

  if (fs.existsSync(typesNodeModulesPath)) {
    fs.rmSync(typesNodeModulesPath, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(typesNodeModulesPath), { recursive: true });
  const relativeTarget = path.relative(path.dirname(typesNodeModulesPath), typesPackagePath);
  fs.symlinkSync(relativeTarget, typesNodeModulesPath, 'dir');

  fs.rmSync(backupDir, { recursive: true, force: true });
}
