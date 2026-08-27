import * as vscode from 'vscode';
import type { IProxyOutput } from '../domain/ports/IProxyOutput';

export interface AccountsPanelProxyOutputDependencies {
  proxyOutput: Pick<IProxyOutput, 'getLogDirectory'>;
}

/** Handles proxy log-directory and traffic-output navigation actions. */
export class AccountsPanelProxyOutputHandlers {
  constructor(
    private readonly dependencies: AccountsPanelProxyOutputDependencies
  ) {}

  async showLogs(): Promise<void> {
    await vscode.commands.executeCommand(
      'revealFileInOS',
      vscode.Uri.file(this.dependencies.proxyOutput.getLogDirectory())
    );
  }

  async showTraffic(): Promise<void> {
    await vscode.commands.executeCommand('cursorAccounts.proxy.showOutput');
  }
}
