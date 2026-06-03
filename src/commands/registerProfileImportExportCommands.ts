import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { t } from '../l10n';
import { ProfileExporter } from '../profiles/profileExporter';
import { ProfileImporter } from '../profiles/profileImporter';
import type { ProfileExport } from '../profiles/types';
import type { ProfileCommandDeps } from './profileCommandDeps';

/** Registers profile export and import commands. */
export function registerProfileImportExportCommands(
  context: vscode.ExtensionContext,
  deps: ProfileCommandDeps
): void {
  const { profileManager } = deps;

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

        const importUri = uris[0];
        if (!importUri) {
          return;
        }

        const importer = new ProfileImporter(profileManager);

        const content = await fs.readFile(importUri.fsPath, 'utf-8');
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

        const result = await importer.importFromFile(importUri.fsPath);

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
