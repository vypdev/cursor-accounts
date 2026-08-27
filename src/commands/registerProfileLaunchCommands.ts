import * as vscode from 'vscode';
import { t } from '../l10n';
import { buildProfileLaunchQuickPickItems } from './profileLaunchPresentation';
import type { ProfileCommandDeps } from './profileCommandDeps';

/** Registers profile launch command. */
export function registerProfileLaunchCommands(
  context: vscode.ExtensionContext,
  deps: ProfileCommandDeps
): void {
  const { profileManager, profileLauncher } = deps;

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorAccounts.launchProfile', async () => {
      try {
        const profiles = await profileManager.getProfiles();

        if (profiles.length === 0) {
          const create = await vscode.window.showInformationMessage(
            t('commands.launchProfile.noProfilesCreate'),
            t('commands.launchProfile.createProfile')
          );
          if (create) {
            await vscode.commands.executeCommand('cursorAccounts.addProfile');
          }
          return;
        }

        const selected = await vscode.window.showQuickPick(
          buildProfileLaunchQuickPickItems(
            profiles,
            {
              lastLaunched: (date) =>
                t('commands.launchProfile.lastLaunched', { date }),
              lastLaunchedNever: t('commands.launchProfile.lastLaunchedNever'),
            },
            (date) => new Date(date).toLocaleString()
          ),
          {
            placeHolder: t('commands.launchProfile.selectPlaceholder'),
          }
        );

        if (!selected) {
          return;
        }

        const validation = await profileLauncher.validateExecutable();
        if (!validation.valid) {
          vscode.window.showErrorMessage(
            validation.error ?? t('errors.cursorExecutableNotFound')
          );
          return;
        }

        const result = await profileLauncher.launch(selected.profile.id);

        if (result.success) {
          vscode.window.showInformationMessage(
            t('commands.addProfile.launching', {
              name: selected.profile.displayName,
            })
          );
        } else {
          vscode.window.showErrorMessage(
            t('commands.launchProfile.failedLaunch', {
              error: result.error ?? t('errors.unknown'),
            })
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          t('commands.launchProfile.failedLaunch', {
            error: error instanceof Error ? error.message : t('errors.unknown'),
          })
        );
      }
    })
  );
}
