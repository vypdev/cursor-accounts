#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const backupDir = path.join(root, '.build-backup');
const packageBackupPath = path.join(backupDir, 'package.json');
const cursorAccountsScopePath = path.join(root, 'node_modules', '@cursor-accounts');

const WORKSPACE_PACKAGES = [
  {
    dependencyName: '@cursor-accounts/types',
    packagePath: path.join(root, 'packages', 'types'),
    nodeModulesPath: path.join(cursorAccountsScopePath, 'types'),
  },
  {
    dependencyName: '@cursor-accounts/shared',
    packagePath: path.join(root, 'packages', 'shared'),
    nodeModulesPath: path.join(cursorAccountsScopePath, 'shared'),
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'node_modules') {
      continue;
    }
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function materializeWorkspacePackage({ dependencyName, packagePath, nodeModulesPath }) {
  const packageJsonPath = path.join(packagePath, 'package.json');
  const distEntryPath = path.join(packagePath, 'dist', 'index.js');

  if (!fs.existsSync(distEntryPath)) {
    throw new Error(
      `Missing compiled ${dependencyName} package. Run pnpm run bundle before packaging.`
    );
  }

  if (fs.existsSync(nodeModulesPath)) {
    fs.rmSync(nodeModulesPath, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(nodeModulesPath), { recursive: true });
  copyDirectory(packagePath, nodeModulesPath);

  const productionPackage = readJson(path.join(nodeModulesPath, 'package.json'));
  delete productionPackage.devDependencies;
  writeJson(path.join(nodeModulesPath, 'package.json'), productionPackage);

  return readJson(packageJsonPath).version;
}

function restoreWorkspaceSymlink({ packagePath, nodeModulesPath }) {
  if (fs.existsSync(nodeModulesPath)) {
    fs.rmSync(nodeModulesPath, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(nodeModulesPath), { recursive: true });
  const relativeTarget = path.relative(path.dirname(nodeModulesPath), packagePath);
  fs.symlinkSync(relativeTarget, nodeModulesPath, 'dir');
}

export function saveState() {
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), packageBackupPath);
}

export function convertToProduction() {
  const rootPackage = readJson(path.join(root, 'package.json'));
  let rootPackageUpdated = false;

  for (const workspacePackage of WORKSPACE_PACKAGES) {
    const version = materializeWorkspacePackage(workspacePackage);
    const workspaceDependency =
      rootPackage.dependencies?.[workspacePackage.dependencyName];

    if (workspaceDependency?.startsWith('workspace:')) {
      rootPackage.dependencies[workspacePackage.dependencyName] = version;
      rootPackageUpdated = true;
    }
  }

  if (rootPackageUpdated) {
    writeJson(path.join(root, 'package.json'), rootPackage);
  }
}

export function restoreState() {
  if (!fs.existsSync(packageBackupPath)) {
    return;
  }

  fs.copyFileSync(packageBackupPath, path.join(root, 'package.json'));

  for (const workspacePackage of WORKSPACE_PACKAGES) {
    restoreWorkspaceSymlink(workspacePackage);
  }

  fs.rmSync(backupDir, { recursive: true, force: true });
}
