import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { t } from '../l10n';
import { ProfileExporter } from '../profiles/profileExporter';
import type { ProfileCommandDeps } from './profileCommandDeps';

interface ProfileExportPick {
  id: string;
}

/** Registers the profile export command at the VS Code boundary. */
export function registerProfileExportCommand(
  context: vscode.ExtensionContext,
  deps: ProfileCommandDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorAccounts.exportProfiles', () =>
      executeProfileExport(deps)
    )
  );
}

async function executeProfileExport(deps: ProfileCommandDeps): Promise<void> {
  try {
    const profiles = await deps.profileManager.getProfiles();
    if (profiles.length === 0) {
      vscode.window.showInformationMessage(
        t('commands.exportProfiles.noProfiles')
      );
      return;
    }

    const selected = await vscode.window.showQuickPick(
      [
        { label: t('commands.exportProfiles.exportAll'), id: 'all' },
        ...profiles.map((profile) => ({
          label: profile.displayName,
          description: profile.email,
          id: profile.id,
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

    const profileIds = resolveProfileIds(profiles, selected);
    const yesLabel = t('commands.exportProfiles.yes');
    const includeSettings = await vscode.window.showQuickPick(
      [yesLabel, t('commands.exportProfiles.no')],
      { placeHolder: t('commands.exportProfiles.includeSettings') }
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

    await new ProfileExporter(deps.profileManager).exportToFile(
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
}

function resolveProfileIds(
  profiles: Awaited<ReturnType<ProfileCommandDeps['profileManager']['getProfiles']>>,
  selected: readonly ProfileExportPick[]
): string[] {
  if (selected.some((item) => item.id === 'all')) {
    return profiles.map((profile) => profile.id);
  }
  return selected
    .filter((item) => item.id !== 'all')
    .map((item) => item.id);
}
