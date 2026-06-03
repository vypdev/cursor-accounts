import * as vscode from 'vscode';
import * as extensionLog from '../logging/extensionLog';
import { t } from '../l10n';
import type { ProfileCommandDeps } from './profileCommandDeps';

/** Registers add, delete, list, and show-current profile commands. */
export function registerProfileCrudCommands(
  context: vscode.ExtensionContext,
  deps: ProfileCommandDeps
): void {
  const { profileManager, profileLauncher, profileDetector } = deps;

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorAccounts.addProfile', async () => {
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

        if (launch === t('commands.addProfile.launch')) {
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
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          t('commands.addProfile.failedCreate', {
            error: error instanceof Error ? error.message : t('errors.unknown'),
          })
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorAccounts.listProfiles', async () => {
      try {
        const profiles = await profileManager.getProfiles();
        const current = await profileDetector.detectCurrentProfile();

        if (profiles.length === 0) {
          vscode.window.showInformationMessage(
            t('commands.listProfiles.noProfiles')
          );
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
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorAccounts.deleteProfile', async () => {
      try {
        const profiles = await profileManager.getProfiles();

        if (profiles.length === 0) {
          vscode.window.showInformationMessage(
            t('commands.deleteProfile.noProfiles')
          );
          return;
        }

        const selected = await vscode.window.showQuickPick(
          profiles.map((p) => ({
            label: p.displayName,
            description: p.email,
            profile: p,
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
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'cursorAccounts.showCurrentProfile',
      async () => {
        try {
          const current = await profileDetector.detectCurrentProfile();

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
    )
  );
}
