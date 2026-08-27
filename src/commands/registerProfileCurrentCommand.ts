import * as vscode from 'vscode';
import { t } from '../l10n';
import type { ProfileCommandDeps } from './profileCommandDeps';

/** Registers the current-profile command at the VS Code boundary. */
export function registerProfileCurrentCommand(
  context: vscode.ExtensionContext,
  deps: ProfileCommandDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorAccounts.showCurrentProfile', () =>
      executeShowCurrentProfile(deps)
    )
  );
}

async function executeShowCurrentProfile(
  deps: ProfileCommandDeps
): Promise<void> {
  try {
    const current = await deps.profileDetector.detectCurrentProfile();

    if (!current) {
      vscode.window.showInformationMessage(
        t('commands.showCurrentProfile.default')
      );
      return;
    }

    vscode.window.showInformationMessage(
      t('commands.showCurrentProfile.current', {
        name: current.displayName,
        email: current.email,
      })
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      t('commands.showCurrentProfile.failed', {
        error: error instanceof Error ? error.message : t('errors.unknown'),
      })
    );
  }
}
