import * as vscode from 'vscode';
import type { IProfileWriter } from '../domain/ports/IProfileWriter';
import * as extensionLog from '../logging/extensionLog';
import { t } from '../l10n';
import type { ToWebviewMessage } from '../profiles/types';

export interface AccountsPanelGithubHandlerDependencies {
  profileWriter: IProfileWriter;
}

export interface AccountsPanelGithubHandlerCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
  refreshGithubSummaries(): Promise<void>;
}

/** Handles per-profile GitHub token selection and removal. */
export class AccountsPanelGithubHandlers {
  constructor(
    private readonly dependencies: AccountsPanelGithubHandlerDependencies,
    private readonly callbacks: AccountsPanelGithubHandlerCallbacks
  ) {}

  async configure(profileId: string): Promise<void> {
    const profile = await this.dependencies.profileWriter.getProfile(profileId);
    if (!profile) {
      await this.callbacks.postMessage({
        type: 'error',
        message: t('errors.profileNotFound'),
      });
      return;
    }

    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: t('panel.githubTokenSelectFile'),
      title: t('panel.githubTokenDialogTitle'),
    });

    if (!selection?.[0]) {
      return;
    }

    const tokenPath = selection[0].fsPath;
    await this.dependencies.profileWriter.updateProfile(profileId, {
      githubTokenPath: tokenPath,
    });

    await this.callbacks.postMessage({
      type: 'success',
      message: t('panel.githubTokenConfigured', { name: profile.displayName }),
    });
    await this.callbacks.refreshGithubSummaries();
  }

  async clear(profileId: string): Promise<void> {
    const profile = await this.dependencies.profileWriter.getProfile(profileId);
    if (!profile) {
      extensionLog.debug(
        `[AccountsPanel] GitHub token clear ignored for missing profile ${profileId}`
      );
      return;
    }

    await this.dependencies.profileWriter.updateProfile(profileId, {
      githubTokenPath: undefined,
    });

    await this.callbacks.postMessage({
      type: 'success',
      message: t('panel.githubTokenCleared', { name: profile.displayName }),
    });
    await this.callbacks.refreshGithubSummaries();
  }
}
