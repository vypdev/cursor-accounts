import * as vscode from 'vscode';

const SECTION = 'cursorQuota';

export interface CursorQuotaConfig {
  refreshEnabled: boolean;
  refreshIntervalSeconds: number;
  showIncluded: boolean;
  showTotal: boolean;
  showAccountEmail: boolean;
  showProfileInStatusBar: boolean;
}

export function getCursorQuotaConfig(): CursorQuotaConfig {
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

export function affectsCursorQuotaConfig(
  event: vscode.ConfigurationChangeEvent
): boolean {
  return event.affectsConfiguration(SECTION);
}
