import * as path from 'path';
import * as vscode from 'vscode';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProfileLauncher } from '../domain/ports/IProfileLauncher';
import * as extensionLog from '../logging/extensionLog';
import { t } from '../l10n';
import type { ProfileWorkspaceService } from '../application/services/profileWorkspaceService';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { ToWebviewMessage } from '../profiles/types';
import { getOpenWorkspacePaths } from '../services/activeWorkspaceService';
import { resolveRecentProjectLaunch } from '../profiles/recentProjectLaunchRouter';

export interface AccountsPanelLaunchHandlerDependencies {
  profileManager: IProfileManager;
  profileLauncher: IProfileLauncher;
  profileDetector: IProfileDetector;
  profileWorkspaceService: ProfileWorkspaceService;
}

export interface AccountsPanelLaunchHandlerCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
  refresh(): Promise<void>;
  refreshInstances(): Promise<void>;
}

/** Handles profile launch routing and prevents duplicate concurrent launches. */
export class AccountsPanelLaunchHandlers {
  private readonly launchInFlight = new Set<string>();

  constructor(
    private readonly dependencies: AccountsPanelLaunchHandlerDependencies,
    private readonly callbacks: AccountsPanelLaunchHandlerCallbacks
  ) {}

  async launch(
    profileId: string,
    projectPath?: string
  ): Promise<void> {
    if (this.launchInFlight.has(profileId)) {
      extensionLog.debug(
        `[AccountsPanel] Launch ignored for ${profileId} (already in flight)`
      );
      return;
    }

    this.launchInFlight.add(profileId);
    try {
      extensionLog.info(
        `[AccountsPanel] Launch requested for profile ${profileId}${
          projectPath ? ` with project ${projectPath}` : ''
        }`
      );

      const current = await this.dependencies.profileDetector.detectCurrentProfile();
      const openWorkspacePaths = getOpenWorkspacePaths();

      if (projectPath) {
        const action = resolveRecentProjectLaunch({
          targetProfileId: profileId,
          projectPath,
          currentProfileId: current?.id ?? null,
          openWorkspacePaths,
        });

        if (action.kind === 'noop') {
          extensionLog.debug(
            `[AccountsPanel] Project already open in session: ${projectPath}`
          );
          return;
        }

        if (action.kind === 'openInCurrentWindow') {
          await vscode.commands.executeCommand(
            'vscode.openFolder',
            vscode.Uri.file(action.projectPath),
            { forceNewWindow: false }
          );
          await this.callbacks.refresh();
          return;
        }

        const result = await this.dependencies.profileLauncher.launch(
          action.profileId,
          { projectPath: action.projectPath }
        );
        await this.postLaunchResult(profileId, action.projectPath, result);
        return;
      }

      const resolvedProjectPath =
        await this.dependencies.profileWorkspaceService.getMostRecentWorkspace(
          profileId
        );
      const result = await this.dependencies.profileLauncher.launch(profileId, {
        projectPath: resolvedProjectPath,
      });
      await this.postLaunchResult(profileId, resolvedProjectPath, result);
    } finally {
      this.launchInFlight.delete(profileId);
    }
  }

  private async postLaunchResult(
    profileId: string,
    resolvedProjectPath: string | undefined,
    result: { success: boolean; error?: string }
  ): Promise<void> {
    if (result.success) {
      const profile = await this.dependencies.profileManager.getProfile(profileId);
      const successMessage = resolvedProjectPath
        ? t('panel.launchedWithProject', {
            name: profile?.displayName ?? t('panel.profileFallback'),
            project: path.basename(resolvedProjectPath),
          })
        : t('panel.launched', {
            name: profile?.displayName ?? t('panel.profileFallback'),
          });
      await this.callbacks.postMessage({
        type: 'success',
        message: successMessage,
      });
      await this.callbacks.refresh();
      void this.callbacks.refreshInstances();
      return;
    }

    await this.callbacks.postMessage({
      type: 'error',
      message: result.error ?? t('errors.failedLaunchProfile'),
    });
  }
}
