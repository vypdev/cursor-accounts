import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { t } from '../l10n';
import { ProfileImporter } from '../profiles/profileImporter';
import type { ProfileExport } from '../profiles/types';
import type { ProfileCommandDeps } from './profileCommandDeps';

/** Registers the profile import command at the VS Code boundary. */
export function registerProfileImportCommand(
  context: vscode.ExtensionContext,
  deps: ProfileCommandDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorAccounts.importProfiles', () =>
      executeProfileImport(deps)
    )
  );
}

async function executeProfileImport(deps: ProfileCommandDeps): Promise<void> {
  try {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { JSON: ['json'] },
      openLabel: 'Import',
    });
    const importUri = uris?.[0];
    if (!importUri) {
      return;
    }

    const importer = new ProfileImporter(deps.profileManager);
    const content = await fs.readFile(importUri.fsPath, 'utf-8');
    const validation = await importer.validateImport(
      JSON.parse(content) as ProfileExport
    );
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
    const messages = formatImportResultMessages(result);
    if (result.success) {
      vscode.window.showInformationMessage(messages);
    } else {
      vscode.window.showWarningMessage(messages);
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      t('commands.importProfiles.failed', {
        error: error instanceof Error ? error.message : t('errors.unknown'),
      })
    );
  }
}

function formatImportResultMessages(result: {
  imported: unknown[];
  skipped: unknown[];
  errors: unknown[];
}): string {
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
  return messages.join(', ');
}
