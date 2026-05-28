import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as extensionLog from '../logging/extensionLog';
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
          prompt: 'Enter Cursor account email',
          placeHolder: 'user@example.com',
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
            `Profile with email ${email} already exists`
          );
          return;
        }

        const displayName = await vscode.window.showInputBox({
          prompt: 'Enter profile display name (optional)',
          placeHolder: 'e.g., Work, Personal, Client',
        });

        const profile = await profileManager.createProfile({
          email,
          displayName,
        });

        const launch = await vscode.window.showInformationMessage(
          `Profile "${profile.displayName}" created. Launch now?`,
          'Launch',
          'Later'
        );

        if (launch === 'Launch') {
          const result = await profileLauncher.launch(profile.id);
          if (result.success) {
            vscode.window.showInformationMessage(
              `Launching ${profile.displayName}...`
            );
          } else {
            vscode.window.showErrorMessage(
              `Failed to launch profile: ${result.error}`
            );
          }
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to create profile: ${error instanceof Error ? error.message : 'Unknown error'}`
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
            'No profiles configured. Create one now?',
            'Create Profile'
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
            detail: `Last launched: ${p.lastLaunched ? new Date(p.lastLaunched).toLocaleString() : 'Never'}`,
            profile: p,
          })),
          {
            placeHolder: 'Select profile to launch',
          }
        );

        if (!selected) {
          return;
        }

        const validation = await profileLauncher.validateExecutable();
        if (!validation.valid) {
          vscode.window.showErrorMessage(
            validation.error ?? 'Cursor executable not found'
          );
          return;
        }

        const result = await profileLauncher.launch(selected.profile.id);

        if (result.success) {
          vscode.window.showInformationMessage(
            `Launching ${selected.profile.displayName}...`
          );
        } else {
          vscode.window.showErrorMessage(
            `Failed to launch profile: ${result.error}`
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to launch profile: ${error instanceof Error ? error.message : 'Unknown error'}`
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
            'No profiles configured. Use "Cursor Accounts: Add Profile" to create one.'
          );
          return;
        }

        extensionLog.clear();
        extensionLog.appendLine('Configured Cursor Profiles:');
        extensionLog.appendLine('');

        for (const profile of profiles) {
          const isCurrent = current?.id === profile.id;
          extensionLog.appendLine(
            `${isCurrent ? '● ' : '○ '}${profile.displayName}`
          );
          extensionLog.appendLine(`  Email: ${profile.email}`);
          extensionLog.appendLine(`  Path: ${profile.userDataDir}`);
          if (profile.lastLaunched) {
            extensionLog.appendLine(
              `  Last launched: ${new Date(profile.lastLaunched).toLocaleString()}`
            );
          }
          extensionLog.appendLine('');
        }

        extensionLog.show();
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to list profiles: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorAccounts.deleteProfile', async () => {
      try {
        const profiles = await profileManager.getProfiles();

        if (profiles.length === 0) {
          vscode.window.showInformationMessage('No profiles to delete.');
          return;
        }

        const selected = await vscode.window.showQuickPick(
          profiles.map((p) => ({
            label: p.displayName,
            description: p.email,
            profile: p,
          })),
          {
            placeHolder: 'Select profile to delete',
          }
        );

        if (!selected) {
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `Delete profile "${selected.profile.displayName}"? This will NOT delete the user data directory.`,
          { modal: true },
          'Delete'
        );

        if (confirm !== 'Delete') {
          return;
        }

        await profileManager.deleteProfile(selected.profile.id);

        vscode.window.showInformationMessage(
          `Profile "${selected.profile.displayName}" deleted.`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to delete profile: ${error instanceof Error ? error.message : 'Unknown error'}`
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
              'Using default Cursor profile (no custom profile active)'
            );
            return;
          }

          vscode.window.showInformationMessage(
            `Current profile: ${current.displayName} (${current.email})`
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to detect current profile: ${error instanceof Error ? error.message : 'Unknown error'}`
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
          vscode.window.showInformationMessage('No profiles to export.');
          return;
        }

        const selected = await vscode.window.showQuickPick(
          [
            { label: 'Export All Profiles', id: 'all' },
            ...profiles.map((p) => ({
              label: p.displayName,
              description: p.email,
              id: p.id,
              picked: true,
            })),
          ],
          {
            placeHolder: 'Select profiles to export',
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

        const includeSettings = await vscode.window.showQuickPick(['Yes', 'No'], {
          placeHolder: 'Include VS Code settings.json?',
        });

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
          includeSettings === 'Yes'
        );

        vscode.window.showInformationMessage(
          `Exported ${profileIds.length} profile(s) to ${uri.fsPath}`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to export profiles: ${error instanceof Error ? error.message : 'Unknown error'}`
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
            `Invalid import file: ${validation.errors.join(', ')}`
          );
          return;
        }

        if (validation.warnings.length > 0) {
          const proceed = await vscode.window.showWarningMessage(
            `Warnings:\n${validation.warnings.join('\n')}\n\nContinue?`,
            { modal: true },
            'Continue'
          );
          if (proceed !== 'Continue') {
            return;
          }
        }

        const result = await importer.importFromFile(uris[0].fsPath);

        const messages: string[] = [];
        if (result.imported.length > 0) {
          messages.push(`Imported: ${result.imported.length}`);
        }
        if (result.skipped.length > 0) {
          messages.push(`Skipped: ${result.skipped.length}`);
        }
        if (result.errors.length > 0) {
          messages.push(`Errors: ${result.errors.length}`);
        }

        if (result.success) {
          vscode.window.showInformationMessage(messages.join(', '));
        } else {
          vscode.window.showWarningMessage(messages.join(', '));
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to import profiles: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    })
  );
}
