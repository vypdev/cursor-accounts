import * as vscode from 'vscode';
import { LEGACY_SECRETS_KEYS, SECRETS_KEYS } from '../auth/cursorPaths';

export const LEGACY_SETTINGS_KEYS = [
  'refresh.enabled',
  'refresh.intervalSeconds',
  'statusBar.showIncluded',
  'statusBar.showTotal',
  'statusBar.showAccountEmail',
  'profiles.autoDetectRunning',
  'profiles.showProfileInStatusBar',
  'profiles.refreshAllInterval',
  'profiles.instanceDetectionInterval',
] as const;

export function migrateSettingsFromCursorQuota(): number {
  const oldSection = vscode.workspace.getConfiguration('cursorQuota');
  const newSection = vscode.workspace.getConfiguration('cursorAccounts');
  let migratedCount = 0;

  for (const key of LEGACY_SETTINGS_KEYS) {
    const oldInspect = oldSection.inspect<unknown>(key);
    const newInspect = newSection.inspect<unknown>(key);
    if (!oldInspect) {
      continue;
    }

    if (
      newInspect?.globalValue === undefined &&
      oldInspect.globalValue !== undefined
    ) {
      void newSection.update(
        key,
        oldInspect.globalValue,
        vscode.ConfigurationTarget.Global
      );
      migratedCount += 1;
    }

    if (
      newInspect?.workspaceValue === undefined &&
      oldInspect.workspaceValue !== undefined
    ) {
      void newSection.update(
        key,
        oldInspect.workspaceValue,
        vscode.ConfigurationTarget.Workspace
      );
      migratedCount += 1;
    }

    if (
      newInspect?.workspaceFolderValue === undefined &&
      oldInspect.workspaceFolderValue !== undefined
    ) {
      void newSection.update(
        key,
        oldInspect.workspaceFolderValue,
        vscode.ConfigurationTarget.WorkspaceFolder
      );
      migratedCount += 1;
    }
  }

  return migratedCount;
}

export async function migrateSecretsFromCursorQuota(
  context: vscode.ExtensionContext
): Promise<{ skipped: boolean; migratedTokenCount: number }> {
  const newAccess = await context.secrets.get(SECRETS_KEYS.accessToken);
  if (newAccess) {
    return { skipped: true, migratedTokenCount: 0 };
  }

  const oldAccess = await context.secrets.get(LEGACY_SECRETS_KEYS.accessToken);
  const oldRefresh = await context.secrets.get(
    LEGACY_SECRETS_KEYS.refreshToken
  );

  let migratedTokenCount = 0;
  if (oldAccess) {
    await context.secrets.store(SECRETS_KEYS.accessToken, oldAccess);
    migratedTokenCount += 1;
  }
  if (oldRefresh) {
    await context.secrets.store(SECRETS_KEYS.refreshToken, oldRefresh);
    migratedTokenCount += 1;
  }

  return { skipped: false, migratedTokenCount };
}
