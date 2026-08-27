import * as vscode from 'vscode';
import { t } from '../l10n';
import type { ProfileCommandDeps } from './profileCommandDeps';

/** Registers the profile deletion command at the VS Code boundary. */
export function registerProfileDeleteCommand(
  context: vscode.ExtensionContext,
  deps: ProfileCommandDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorAccounts.deleteProfile', () =>
      executeProfileDelete(deps)
    )
  );
}

async function executeProfileDelete(deps: ProfileCommandDeps): Promise<void> {
  const { profileManager } = deps;

  try {
    const profiles = await profileManager.getProfiles();

    if (profiles.length === 0) {
      vscode.window.showInformationMessage(t('commands.deleteProfile.noProfiles'));
      return;
    }

    const selected = await vscode.window.showQuickPick(
      profiles.map((profile) => ({
        label: profile.displayName,
        description: profile.email,
        profile,
      })),
      {
        placeHolder: t('commands.deleteProfile.selectPlaceholder'),
      }
    );

    if (!selected) {
      return;
    }

    const deleteLabel = t('commands.deleteProfile.delete');
    const confirm = await vscode.window.showWarningMessage(
      t('commands.deleteProfile.confirm', {
        name: selected.profile.displayName,
      }),
      { modal: true },
      deleteLabel
    );

    if (confirm !== deleteLabel) {
      return;
    }

    await profileManager.deleteProfile(
      selected.profile.id,
      deps.instanceDetector
    );

    vscode.window.showInformationMessage(
      t('commands.deleteProfile.deleted', {
        name: selected.profile.displayName,
      })
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      t('commands.deleteProfile.failed', {
        error: error instanceof Error ? error.message : t('errors.unknown'),
      })
    );
  }
}
