import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as extensionLog from '../logging/extensionLog';
import { t } from '../l10n';
import { ProfileExporter } from '../profiles/profileExporter';
import { ProfileImporter } from '../profiles/profileImporter';
import { ProfileDetector } from '../profiles/profileDetector';
import { ProfileLauncher } from '../profiles/profileLauncher';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileExport } from '../profiles/types';

export function registerProfileCommands(
  context: vscode.ExtensionContext,
  profileManager: ProfileManager,
  profileLauncher: ProfileLauncher,
  profileDetector: ProfileDetector
): void {
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
          profiles.map((p) => ({
            label: p.displayName,
            description: p.email,
            detail: t('commands.launchProfile.lastLaunched', {
              date: p.lastLaunched
                ? new Date(p.lastLaunched).toLocaleString()
                : t('commands.launchProfile.lastLaunchedNever'),
            }),
            profile: p,
          })),
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

        await profileManager.deleteProfile(selected.profile.id);

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

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorAccounts.exportProfiles', async () => {
      try {
        const profiles = await profileManager.getProfiles();

        if (profiles.length === 0) {
          vscode.window.showInformationMessage(
            t('commands.exportProfiles.noProfiles')
          );
          return;
        }

        const selected = await vscode.window.showQuickPick(
          [
            {
              label: t('commands.exportProfiles.exportAll'),
              id: 'all',
            },
            ...profiles.map((p) => ({
              label: p.displayName,
              description: p.email,
              id: p.id,
              picked: true,
            })),
          ],
          {
            placeHolder: t('commands.exportProfiles.selectPlaceholder'),
            canPickMany: true,
          }
        );

        if (!selected || selected.length === 0) {
          return;
        }

        const exportAll = selected.some((s) => s.id === 'all');
        const profileIds = exportAll
          ? profiles.map((p) => p.id)
          : selected.filter((s) => s.id !== 'all').map((s) => s.id);

        const yesLabel = t('commands.exportProfiles.yes');
        const includeSettings = await vscode.window.showQuickPick(
          [yesLabel, t('commands.exportProfiles.no')],
          {
            placeHolder: t('commands.exportProfiles.includeSettings'),
          }
        );

        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(
            path.join(os.homedir(), 'Downloads', 'cursor-profiles-export.json')
          ),
          filters: { JSON: ['json'] },
        });

        if (!uri) {
          return;
        }

        const exporter = new ProfileExporter(profileManager);
        await exporter.exportToFile(
          profileIds,
          uri.fsPath,
          includeSettings === yesLabel
        );

        vscode.window.showInformationMessage(
          t('commands.exportProfiles.exported', {
            count: profileIds.length,
            path: uri.fsPath,
          })
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          t('commands.exportProfiles.failed', {
            error: error instanceof Error ? error.message : t('errors.unknown'),
          })
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorAccounts.importProfiles', async () => {
      try {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { JSON: ['json'] },
          openLabel: 'Import',
        });

        if (!uris || uris.length === 0) {
          return;
        }

        const importer = new ProfileImporter(profileManager);

        const content = await fs.readFile(uris[0].fsPath, 'utf-8');
        const exportData = JSON.parse(content) as ProfileExport;
        const validation = await importer.validateImport(exportData);

        if (!validation.valid) {
          vscode.window.showErrorMessage(
            t('commands.importProfiles.invalidFile', {
              errors: validation.errors.join(', '),
            })
          );
          return;
        }

        if (validation.warnings.length > 0) {
          const continueLabel = t('commands.importProfiles.continue');
          const proceed = await vscode.window.showWarningMessage(
            t('commands.importProfiles.warningsContinue', {
              warnings: validation.warnings.join('\n'),
            }),
            { modal: true },
            continueLabel
          );
          if (proceed !== continueLabel) {
            return;
          }
        }

        const result = await importer.importFromFile(uris[0].fsPath);

        const messages: string[] = [];
        if (result.imported.length > 0) {
          messages.push(
            t('commands.importProfiles.imported', {
              count: result.imported.length,
            })
          );
        }
        if (result.skipped.length > 0) {
          messages.push(
            t('commands.importProfiles.skipped', {
              count: result.skipped.length,
            })
          );
        }
        if (result.errors.length > 0) {
          messages.push(
            t('commands.importProfiles.errors', {
              count: result.errors.length,
            })
          );
        }

        if (result.success) {
          vscode.window.showInformationMessage(messages.join(', '));
        } else {
          vscode.window.showWarningMessage(messages.join(', '));
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          t('commands.importProfiles.failed', {
            error: error instanceof Error ? error.message : t('errors.unknown'),
          })
        );
      }
    })
  );
}
