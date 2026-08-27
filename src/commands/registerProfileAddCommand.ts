import * as vscode from 'vscode';
import { t } from '../l10n';
import type { ProfileCommandDeps } from './profileCommandDeps';

/** Registers the profile creation command at the VS Code boundary. */
export function registerProfileAddCommand(
  context: vscode.ExtensionContext,
  deps: ProfileCommandDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorAccounts.addProfile', () =>
      executeProfileAdd(deps)
    )
  );
}

async function executeProfileAdd(deps: ProfileCommandDeps): Promise<void> {
  const { profileManager, profileLauncher } = deps;

  try {
    const email = await vscode.window.showInputBox({
      prompt: t('commands.addProfile.promptEmail'),
      placeHolder: t('commands.addProfile.emailPlaceholder'),
      validateInput: (value) => {
        const validation = profileManager.validateEmail(value);
        return validation.valid ? null : validation.errors.join(', ');
      },
    });

    if (!email) {
      return;
    }

    const existing = await profileManager.findProfileByEmail(email);
    if (existing) {
      vscode.window.showErrorMessage(
        t('commands.addProfile.profileExists', { email })
      );
      return;
    }

    const displayName = await vscode.window.showInputBox({
      prompt: t('commands.addProfile.promptDisplayName'),
      placeHolder: t('commands.addProfile.displayNamePlaceholder'),
    });

    const profile = await profileManager.createProfile({
      email,
      displayName,
    });

    const launch = await vscode.window.showInformationMessage(
      t('commands.addProfile.createdLaunchNow', { name: profile.displayName }),
      t('commands.addProfile.launch'),
      t('commands.addProfile.later')
    );

    if (launch !== t('commands.addProfile.launch')) {
      return;
    }

    const result = await profileLauncher.launch(profile.id);
    if (result.success) {
      vscode.window.showInformationMessage(
        t('commands.addProfile.launching', { name: profile.displayName })
      );
    } else {
      vscode.window.showErrorMessage(
        t('commands.addProfile.failedLaunch', {
          error: result.error ?? t('errors.unknown'),
        })
      );
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      t('commands.addProfile.failedCreate', {
        error: error instanceof Error ? error.message : t('errors.unknown'),
      })
    );
  }
}
