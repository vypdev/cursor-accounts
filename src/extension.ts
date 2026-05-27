import * as vscode from 'vscode';
import { QuotaClient } from './api/quotaClient';
import { TokenService } from './auth/tokenRefresh';
import { affectsCursorQuotaConfig } from './config';
import { RefreshService } from './services/refreshService';
import { StatusBarManager } from './ui/statusBarManager';

let refreshService: RefreshService | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const statusBar = new StatusBarManager(context);
  statusBar.showOnActivate();

  const tokenService = new TokenService(context);
  const quotaClient = new QuotaClient(tokenService);

  refreshService = new RefreshService(
    context,
    quotaClient,
    (usage) => statusBar.render(usage),
    (message) => statusBar.showError(message)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (affectsCursorQuotaConfig(event)) {
        statusBar.applyVisibilityFromConfig();
      }
    }),
    vscode.commands.registerCommand('cursorQuota.refresh', async () => {
      await refreshService?.tickNow();
    }),
    vscode.commands.registerCommand('cursorQuota.openUsage', async () => {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@id:cursor'
      );
      vscode.window.showInformationMessage(
        'Open Cursor Settings and select the Usage section to view full quota details.'
      );
    })
  );

  refreshService.start();
}

export function deactivate(): void {
  refreshService = undefined;
}
