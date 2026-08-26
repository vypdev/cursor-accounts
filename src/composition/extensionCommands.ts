import * as vscode from 'vscode';
import type { QuotaUsage } from '../domain';
import { isEnterpriseUsage } from '../domain';
import { affectsCursorAccountsConfig } from '../config';
import { t } from '../l10n';
import { registerProfileCommands } from '../commands/profileCommands';
import { registerProxyCommands } from '../commands/proxyCommands';
import type { ExtensionRuntime } from './createExtensionRuntime';

/** Registers extension commands at the composition boundary. */
export function registerExtensionCommands(
  context: vscode.ExtensionContext,
  runtime: ExtensionRuntime
): void {
  const {
    profileManager,
    profileLauncher,
    profileDetector,
    instanceDetector,
    proxyManager,
    accountsPanel,
    refreshService,
    efficiencyService,
    activeConversationStatusBar,
  } = runtime;

  registerProfileCommands(
    context,
    profileManager,
    profileLauncher,
    profileDetector,
    instanceDetector
  );

  registerProxyCommands(context, proxyManager, profileDetector, () => {
    void accountsPanel.refreshProxyStatus();
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (affectsCursorAccountsConfig(event)) {
        runtime.statusBar.applyVisibilityFromConfig();
      }
    }),
    vscode.commands.registerCommand('cursorAccounts.openAccounts', () => {
      if (accountsPanel.hasResolvedView()) {
        accountsPanel.reveal();
      } else {
        accountsPanel.openPanel();
      }
    }),
    vscode.commands.registerCommand('cursorAccounts.refresh', async () => {
      await refreshService.tickNow();
    }),
    vscode.commands.registerCommand('cursorAccounts.openUsage', async () => {
      const cached = context.globalState.get<QuotaUsage>('lastQuota');
      const isEnterprise = cached != null && isEnterpriseUsage(cached);

      if (isEnterprise) {
        await vscode.env.openExternal(
          vscode.Uri.parse('https://cursor.com/dashboard/usage')
        );
        return;
      }

      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@id:cursor'
      );
      vscode.window.showInformationMessage(t('commands.openUsage.message'));
    }),
    vscode.commands.registerCommand(
      'cursorAccounts.efficiency.showOutput',
      () => {
        efficiencyService.getOutputPresenter().show();
      }
    ),
    vscode.commands.registerCommand(
      'cursorAccounts.efficiency.restartDetector',
      async () => {
        await efficiencyService.restartPromptDetector();
      }
    ),
    vscode.commands.registerCommand(
      'cursorAccounts.debug.copyActiveConversationId',
      async () => {
        const id =
          activeConversationStatusBar.getCurrentState()?.lastFocusedComposerId;
        if (!id) {
          vscode.window.showInformationMessage(t('activeConversation.copy.none'));
          return;
        }
        await vscode.env.clipboard.writeText(id);
        vscode.window.showInformationMessage(
          t('activeConversation.copy.success', { id: id.slice(0, 8) })
        );
      }
    )
  );
}
