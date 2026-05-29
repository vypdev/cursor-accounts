import * as path from 'path';
import * as vscode from 'vscode';

export function getEfficiencyApiKeySecretKey(profileId: string): string {
  return `cursorAccounts.efficiency.apiKey.${profileId}`;
}

export function getEfficiencyMetadataDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, 'efficiency-metadata');
}
