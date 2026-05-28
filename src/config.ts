import * as vscode from 'vscode';

const SECTION = 'cursorAccounts';

export interface CursorAccountsConfig {
  refreshEnabled: boolean;
  refreshIntervalSeconds: number;
  showIncluded: boolean;
  showTotal: boolean;
  showAccountEmail: boolean;
  showProfileInStatusBar: boolean;
}

export function getCursorAccountsConfig(): CursorAccountsConfig {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  return {
    refreshEnabled: cfg.get<boolean>('refresh.enabled', true),
    refreshIntervalSeconds: cfg.get<number>('refresh.intervalSeconds', 60),
    showIncluded: cfg.get<boolean>('statusBar.showIncluded', true),
    showTotal: cfg.get<boolean>('statusBar.showTotal', true),
    showAccountEmail: cfg.get<boolean>('statusBar.showAccountEmail', false),
    showProfileInStatusBar: cfg.get<boolean>(
      'profiles.showProfileInStatusBar',
      true
    ),
  };
}

export function affectsCursorAccountsConfig(
  event: vscode.ConfigurationChangeEvent
): boolean {
  return event.affectsConfiguration(SECTION);
}
