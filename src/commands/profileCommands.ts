import * as vscode from 'vscode';
import { ProfileDetector } from '../profiles/profileDetector';
import { ProfileLauncher } from '../profiles/profileLauncher';
import { ProfileManager } from '../profiles/profileManager';

export function registerProfileCommands(
  context: vscode.ExtensionContext,
  profileManager: ProfileManager,
  profileLauncher: ProfileLauncher,
  profileDetector: ProfileDetector
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorQuota.addProfile', async () => {
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
    vscode.commands.registerCommand('cursorQuota.launchProfile', async () => {
      try {
        const profiles = await profileManager.getProfiles();

        if (profiles.length === 0) {
          const create = await vscode.window.showInformationMessage(
            'No profiles configured. Create one now?',
            'Create Profile'
          );
          if (create) {
            await vscode.commands.executeCommand('cursorQuota.addProfile');
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
    vscode.commands.registerCommand('cursorQuota.listProfiles', async () => {
      try {
        const profiles = await profileManager.getProfiles();
        const current = await profileDetector.detectCurrentProfile();

        if (profiles.length === 0) {
          vscode.window.showInformationMessage(
            'No profiles configured. Use "Cursor Quota: Add Profile" to create one.'
          );
          return;
        }

        const output = vscode.window.createOutputChannel('Cursor Profiles');
        output.clear();
        output.appendLine('Configured Cursor Profiles:');
        output.appendLine('');

        for (const profile of profiles) {
          const isCurrent = current?.id === profile.id;
          output.appendLine(`${isCurrent ? '● ' : '○ '}${profile.displayName}`);
          output.appendLine(`  Email: ${profile.email}`);
          output.appendLine(`  Path: ${profile.userDataDir}`);
          if (profile.lastLaunched) {
            output.appendLine(
              `  Last launched: ${new Date(profile.lastLaunched).toLocaleString()}`
            );
          }
          output.appendLine('');
        }

        output.show();
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to list profiles: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorQuota.deleteProfile', async () => {
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
      'cursorQuota.showCurrentProfile',
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
}
