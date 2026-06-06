#!/usr/bin/env node
import { readFileSync } from 'fs';

/**
 * Maps VS Code version to Electron version.
 * 
 * @param {string} vscodeVersion - Version from package.json engines.vscode (e.g., "^1.95.0")
 * @returns {string} Electron version (e.g., "32.0.0")
 * 
 * @remarks
 * This mapping must be updated when VS Code updates its Electron version.
 * See: https://github.com/microsoft/vscode/blob/main/.yarnrc for current Electron version
 */
export function getElectronVersionForVSCode(vscodeVersion) {
  // Parse vscodeVersion (e.g., "^1.95.0" → "1.95")
  const match = vscodeVersion.match(/\d+\.\d+/);
  if (!match) {
    console.warn(`[get-electron-version] Could not parse VS Code version: ${vscodeVersion}`);
    return '32.0.0'; // Default to latest known
  }
  
  const vscodeMajorMinor = match[0];
  
  // Mapping VS Code → Electron (update periodically)
  // Source: https://github.com/microsoft/vscode/releases
  const knownMappings = {
    '1.85': '25.9.0',   // VS Code 1.85
    '1.90': '29.4.0',   // VS Code 1.90
    '1.95': '32.0.0',   // VS Code 1.95
    '1.96': '32.2.1',   // VS Code 1.96
  };
  
  const electronVersion = knownMappings[vscodeMajorMinor];
  if (!electronVersion) {
    console.warn(
      `[get-electron-version] No mapping for VS Code ${vscodeMajorMinor}, ` +
      `defaulting to Electron 32.0.0`
    );
    return '32.0.0';
  }
  
  return electronVersion;
}

// If executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
  const electronVersion = getElectronVersionForVSCode(packageJson.engines.vscode);
  console.log(electronVersion);
}
