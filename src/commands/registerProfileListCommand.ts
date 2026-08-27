import * as vscode from 'vscode';
import * as extensionLog from '../logging/extensionLog';
import { t } from '../l10n';
import type { ProfileCommandDeps } from './profileCommandDeps';

/** Registers the profile listing command at the VS Code boundary. */
export function registerProfileListCommand(
  context: vscode.ExtensionContext,
  deps: ProfileCommandDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorAccounts.listProfiles', () =>
      executeProfileList(deps)
    )
  );
}

async function executeProfileList(deps: ProfileCommandDeps): Promise<void> {
  const { profileManager, profileDetector } = deps;

  try {
    const profiles = await profileManager.getProfiles();
    const current = await profileDetector.detectCurrentProfile();

    if (profiles.length === 0) {
      vscode.window.showInformationMessage(t('commands.listProfiles.noProfiles'));
      return;
    }

    extensionLog.clear();
    extensionLog.appendLine(t('commands.listProfiles.header'));
    extensionLog.appendLine('');

    for (const profile of profiles) {
      const isCurrent = current?.id === profile.id;
      extensionLog.appendLine(
        `${isCurrent ? '● ' : '○ '}${profile.displayName}`
      );
      extensionLog.appendLine(
        t('commands.listProfiles.email', { email: profile.email })
      );
      extensionLog.appendLine(
        t('commands.listProfiles.path', { path: profile.userDataDir })
      );
      if (profile.lastLaunched) {
        extensionLog.appendLine(
          t('commands.listProfiles.lastLaunched', {
            date: new Date(profile.lastLaunched).toLocaleString(),
          })
        );
      }
      extensionLog.appendLine('');
    }

    extensionLog.show();
  } catch (error) {
    vscode.window.showErrorMessage(
      t('commands.listProfiles.failed', {
        error: error instanceof Error ? error.message : t('errors.unknown'),
      })
    );
  }
}
