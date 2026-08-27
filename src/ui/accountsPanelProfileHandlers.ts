import * as vscode from 'vscode';
import * as extensionLog from '../logging/extensionLog';
import { t } from '../l10n';
import type { IInstanceDetector } from '../domain/ports/IInstanceDetector';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { ProfileProxyEditUseCase } from '../application/services/profileProxyEditUseCase';
import { ProfileExporter } from '../profiles/profileExporter';
import { ProfileImporter } from '../profiles/profileImporter';
import { buildProfileImportFeedback } from './profileImportFeedback';
import type {
  CreateProfileOptions,
  FromWebviewMessage,
  ImportOptions,
  Profile,
  ToWebviewMessage,
} from '../profiles/types';

export interface AccountsPanelProfileHandlerDependencies {
  profileManager: IProfileManager;
  instanceDetector: IInstanceDetector;
  profileProxyEditUseCase: Pick<ProfileProxyEditUseCase, 'execute'>;
}

export interface AccountsPanelProfileHandlerCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
  refresh(): Promise<void>;
  refreshProxyStatus(options?: { checkCertificate?: boolean }): Promise<void>;
}

/** Handles profile CRUD and profile import/export actions from the panel. */
export class AccountsPanelProfileHandlers {
  constructor(
    private readonly dependencies: AccountsPanelProfileHandlerDependencies,
    private readonly callbacks: AccountsPanelProfileHandlerCallbacks
  ) {}

  async add(data: Extract<FromWebviewMessage, { type: 'add' }>): Promise<void> {
    extensionLog.info(`[AccountsPanel] Add profile requested (${data.email})`);
    const options: CreateProfileOptions = {
      email: data.email,
      displayName: data.displayName,
      theme: data.theme,
      color: data.color,
      emoji: data.emoji,
    };
    const profile = await this.dependencies.profileManager.createProfile(options);

    await this.callbacks.postMessage({
      type: 'success',
      message: t('panel.profileCreated', { name: profile.displayName }),
    });
    await this.callbacks.refresh();
  }

  async edit(profileId: string, updates: Partial<Profile>): Promise<void> {
    const profile = await this.dependencies.profileProxyEditUseCase.execute(
      profileId,
      updates
    );

    await this.callbacks.postMessage({
      type: 'success',
      message: t('panel.profileUpdated', { name: profile.displayName }),
    });
    await this.callbacks.refresh();
    await this.callbacks.refreshProxyStatus({ checkCertificate: true });
  }

  async delete(profileId: string): Promise<void> {
    extensionLog.info(
      `[AccountsPanel] Delete profile requested (${profileId})`
    );
    const profile = await this.dependencies.profileManager.getProfile(profileId);
    const displayName = profile?.displayName ?? t('panel.unknownProfile');

    await this.dependencies.profileManager.deleteProfile(
      profileId,
      this.dependencies.instanceDetector
    );

    await this.callbacks.postMessage({
      type: 'success',
      message: t('panel.profileDeleted', { name: displayName }),
    });
    await this.callbacks.refresh();
  }

  async showInExplorer(profileId: string): Promise<void> {
    const profile = await this.dependencies.profileManager.getProfile(profileId);
    if (!profile) {
      throw new Error(t('errors.profileNotFound'));
    }

    await vscode.commands.executeCommand(
      'revealFileInOS',
      vscode.Uri.file(profile.userDataDir)
    );
  }

  async exportProfiles(
    profileIds: string[],
    includeSettings: boolean
  ): Promise<void> {
    extensionLog.info(
      `[AccountsPanel] Export requested (${profileIds.length} profile(s), settings=${includeSettings})`
    );
    const exporter = new ProfileExporter(this.dependencies.profileManager);
    const exportData = await exporter.exportProfiles(profileIds, includeSettings);
    const json = JSON.stringify(exportData, null, 2);
    const timestamp = new Date().toISOString().slice(0, 10);

    await this.callbacks.postMessage({
      type: 'exportData',
      data: json,
      filename: `cursor-profiles-export-${timestamp}.json`,
    });

    await this.callbacks.postMessage({
      type: 'success',
      message: t('panel.exported', { count: exportData.profiles.length }),
    });
  }

  async importProfiles(json: string, options: ImportOptions): Promise<void> {
    extensionLog.info('[AccountsPanel] Import requested');
    const importer = new ProfileImporter(this.dependencies.profileManager);
    const result = await importer.importFromString(json, options);
    const feedback = buildProfileImportFeedback(result, t);

    if (feedback.shouldRefresh) {
      await this.callbacks.refresh();
    }
    await this.callbacks.postMessage(feedback.message);
  }
}
