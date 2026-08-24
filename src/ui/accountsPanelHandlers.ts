import * as vscode from 'vscode';
import * as path from 'path';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import type { IProfileStorageAnalyzer } from '../domain/ports/IProfileStorageAnalyzer';
import type { IStorageCleanupService } from '../domain/ports/IStorageCleanupService';
import * as extensionLog from '../logging/extensionLog';
import { t } from '../l10n';
import type { EfficiencyService } from '../modelEfficiency/efficiencyService';
import { getEfficiencyWrongWindowMessage } from '../modelEfficiency/efficiencyService';
import type { InstanceDetector } from '../profiles/instanceDetector';
import { ProfileExporter } from '../profiles/profileExporter';
import { ProfileImporter } from '../profiles/profileImporter';
import type { ProfileLauncher } from '../profiles/profileLauncher';
import type { ProfileManager } from '../profiles/profileManager';
import type {
  FromWebviewMessage,
  ImportOptions,
  Profile,
  ToWebviewMessage,
} from '../profiles/types';
import type { StorageCleanupOptions } from '@cursor-accounts/types';
import { createEmptyStorageBreakdown } from '@cursor-accounts/types';
import type { ProfileDetector } from '../profiles/profileDetector';
import { resolveRecentProjectLaunch } from '../profiles/recentProjectLaunchRouter';
import type { ProfileWorkspaceService } from '../services/profileWorkspaceService';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import type { IProxyCertificate } from '../domain/ports/IProxyCertificate';
import type { IProxyLifecycle } from '../domain/ports/IProxyLifecycle';
import type { IProxyOutput } from '../domain/ports/IProxyOutput';
import { isProfileProxyEnabled, isProfileProxyJsonlLoggingEnabled } from '@cursor-accounts/types';
import { getOpenWorkspacePaths } from '../services/activeWorkspaceService';
import { buildSuggestedProfileResponse } from './suggestedProfile';
import { AccountsPanelProxyHandlers } from './accountsPanelProxyHandlers';

/** Callbacks the panel provides for webview messaging and refresh orchestration. */
export interface AccountsPanelHandlerCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
  refresh(): Promise<void>;
  refreshInstances(): Promise<void>;
  refreshGithubSummaries(): Promise<void>;
  refreshProxyStatus(options?: { checkCertificate?: boolean }): Promise<void>;
  hasActiveWebview(): boolean;
}

/** Dependencies for Accounts panel user-action handlers (webview message use cases). */
export interface AccountsPanelHandlerDeps {
  profileManager: ProfileManager;
  profileLauncher: ProfileLauncher;
  profileDetector: ProfileDetector;
  efficiencyService: EfficiencyService;
  authReader: IProfileAuthReader;
  instanceDetector: InstanceDetector;
  storageCleanupService: IStorageCleanupService;
  storageAnalyzer: IProfileStorageAnalyzer;
  profileWorkspaceService: ProfileWorkspaceService;
  proxyManager: IProxyLifecycle & IProxyCertificate & IProxyOutput;
  profileSettingsManager?: IProfileSettingsManager;
}

/**
 * Use-case handlers for Accounts panel webview actions.
 * Keeps AccountsPanelProvider focused on webview lifecycle and message routing.
 */
export class AccountsPanelHandlers {
  private readonly launchInFlight = new Set<string>();
  private readonly proxyHandlers: AccountsPanelProxyHandlers;

  constructor(
    private readonly deps: AccountsPanelHandlerDeps,
    private readonly callbacks: AccountsPanelHandlerCallbacks
  ) {
    this.proxyHandlers = new AccountsPanelProxyHandlers(
      {
        profileDetector: deps.profileDetector,
        proxyManager: deps.proxyManager,
      },
      {
        postMessage: (message) => callbacks.postMessage(message),
        refreshProxyStatus: (options) => callbacks.refreshProxyStatus(options),
      }
    );
  }

  async handle(message: FromWebviewMessage): Promise<void> {
    switch (message.type) {
      case 'launch':
        await this.handleLaunch(message.profileId, message.projectPath);
        break;

      case 'add':
        await this.handleAdd(message);
        break;

      case 'edit':
        await this.handleEdit(message.profileId, message.updates);
        break;

      case 'delete':
        await this.handleDelete(message.profileId);
        break;

      case 'showInExplorer':
        await this.handleShowInExplorer(message.profileId);
        break;

      case 'export':
        await this.handleExport(message.profileIds, message.includeSettings);
        break;

      case 'import':
        await this.handleImport(message.data, message.options);
        break;

      case 'requestSuggestedProfile':
        await this.handleRequestSuggestedProfile();
        break;

      case 'toggleEfficiency':
        await this.handleToggleEfficiency(message.profileId, message.enabled);
        break;

      case 'requestStorageInfo':
        await this.handleRequestStorageInfo(message.profileId);
        break;

      case 'cleanStorage':
        await this.handleCleanStorage(message.profileId, message.options);
        break;

      case 'configureGithubToken':
        await this.handleConfigureGithubToken(message.profileId);
        break;

      case 'clearGithubToken':
        await this.handleClearGithubToken(message.profileId);
        break;

      case 'startProxy':
        await this.proxyHandlers.start();
        break;

      case 'stopProxy':
        await this.proxyHandlers.stop();
        break;

      case 'showProxyLogs':
        await this.proxyHandlers.showLogs();
        break;

      case 'showProxyTraffic':
        await this.proxyHandlers.showTraffic();
        break;

      case 'getProxyInstallGuide':
        await this.proxyHandlers.getInstallGuide();
        break;

      case 'installProxyCertificate':
        await this.proxyHandlers.installCertificate();
        break;

      case 'uninstallProxyCertificate':
        await this.proxyHandlers.uninstallCertificate();
        break;

      case 'saveProxyCertificate':
        await this.proxyHandlers.saveCertificate();
        break;

      case 'refreshProxyStatus':
        await this.callbacks.refreshProxyStatus({ checkCertificate: true });
        break;

      default:
        break;
    }
  }

  private async handleLaunch(
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

      const current = await this.deps.profileDetector.detectCurrentProfile();
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

        const result = await this.deps.profileLauncher.launch(
          action.profileId,
          { projectPath: action.projectPath }
        );
        await this.postLaunchResult(profileId, action.projectPath, result);
        return;
      }

      const resolvedProjectPath =
        await this.deps.profileWorkspaceService.getMostRecentWorkspace(
          profileId
        );

      const result = await this.deps.profileLauncher.launch(profileId, {
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
      const profile = await this.deps.profileManager.getProfile(profileId);
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
    } else {
      await this.callbacks.postMessage({
        type: 'error',
        message: result.error ?? t('errors.failedLaunchProfile'),
      });
    }
  }

  private async handleAdd(
    data: Extract<FromWebviewMessage, { type: 'add' }>
  ): Promise<void> {
    extensionLog.info(`[AccountsPanel] Add profile requested (${data.email})`);
    const profile = await this.deps.profileManager.createProfile({
      email: data.email,
      displayName: data.displayName,
      theme: data.theme,
      color: data.color,
      emoji: data.emoji,
    });

    await this.callbacks.postMessage({
      type: 'success',
      message: t('panel.profileCreated', { name: profile.displayName }),
    });
    await this.callbacks.refresh();
  }

  private async handleEdit(
    profileId: string,
    updates: Partial<Profile>
  ): Promise<void> {
    const previousProfile = await this.deps.profileManager.getProfile(profileId);
    const profile = await this.deps.profileManager.updateProfile(
      profileId,
      updates
    );

    const jsonlLoggingChanged =
      'proxyJsonlLoggingEnabled' in updates &&
      previousProfile != null &&
      isProfileProxyJsonlLoggingEnabled(previousProfile) !==
        isProfileProxyJsonlLoggingEnabled(profile);

    if (updates.proxyEnabled === false) {
      await this.deps.proxyManager.stop(profileId);
      if (this.deps.profileSettingsManager) {
        await this.deps.profileSettingsManager.restoreProxySettings(
          profile.userDataDir
        );
      }
    } else if (updates.proxyEnabled === true) {
      const current = await this.deps.profileDetector.detectCurrentProfile();
      if (current?.id === profileId && isProfileProxyEnabled(profile)) {
        await this.deps.proxyManager.ensureProfileProxy(profileId);
      }
    } else if (
      jsonlLoggingChanged &&
      isProfileProxyEnabled(profile) &&
      (await this.deps.proxyManager.isRunning(profileId))
    ) {
      await this.deps.proxyManager.restartProfileProxy(profileId);
    }

    await this.callbacks.postMessage({
      type: 'success',
      message: t('panel.profileUpdated', { name: profile.displayName }),
    });
    await this.callbacks.refresh();
    await this.callbacks.refreshProxyStatus({ checkCertificate: true });
  }

  private async handleDelete(profileId: string): Promise<void> {
    extensionLog.info(
      `[AccountsPanel] Delete profile requested (${profileId})`
    );
    const profile = await this.deps.profileManager.getProfile(profileId);
    const displayName = profile?.displayName ?? t('panel.unknownProfile');

    await this.deps.profileManager.deleteProfile(
      profileId,
      this.deps.instanceDetector
    );

    await this.callbacks.postMessage({
      type: 'success',
      message: t('panel.profileDeleted', { name: displayName }),
    });
    await this.callbacks.refresh();
  }

  private async handleShowInExplorer(profileId: string): Promise<void> {
    const profile = await this.deps.profileManager.getProfile(profileId);
    if (!profile) {
      throw new Error(t('errors.profileNotFound'));
    }

    const uri = vscode.Uri.file(profile.userDataDir);
    await vscode.commands.executeCommand('revealFileInOS', uri);
  }

  private async handleToggleEfficiency(
    profileId: string,
    enabled: boolean
  ): Promise<void> {
    const current = await this.deps.profileDetector.detectCurrentProfile();
    if (!current || current.id !== profileId) {
      throw new Error(getEfficiencyWrongWindowMessage());
    }

    extensionLog.info(
      `[AccountsPanel] Toggle efficiency ${enabled ? 'on' : 'off'} for ${profileId}`
    );

    const result = await this.deps.efficiencyService.setEfficiencyEnabled(
      profileId,
      enabled
    );

    await this.callbacks.postMessage({
      type: 'success',
      message: result.message,
    });
    await this.callbacks.refresh();
  }

  private async handleRequestSuggestedProfile(): Promise<void> {
    if (!this.callbacks.hasActiveWebview()) {
      return;
    }

    try {
      const userDataDir = this.deps.profileDetector.getCurrentUserDataDir();
      const tokens = await this.deps.authReader.readTokens(userDataDir);

      const existing = tokens?.email
        ? await this.deps.profileManager.findProfileByEmail(tokens.email)
        : undefined;

      await this.callbacks.postMessage(
        buildSuggestedProfileResponse(tokens?.email, existing)
      );
    } catch (error) {
      extensionLog.error(
        `[AccountsPanel] Failed to detect current profile email: ${extensionLog.formatError(error)}`
      );

      if (this.callbacks.hasActiveWebview()) {
        await this.callbacks.postMessage({
          type: 'suggestedProfile',
          email: undefined,
          displayName: undefined,
        });
      }
    }
  }

  private async getStorageBreakdown(profileId: string, userDataDir: string) {
    return this.deps.storageAnalyzer.calculateProfileStorageSize(
      profileId,
      userDataDir
    );
  }

  private async handleRequestStorageInfo(profileId: string): Promise<void> {
    const profile = await this.deps.profileManager.getProfile(profileId);
    if (!profile) {
      await this.callbacks.postMessage({
        type: 'storageInfo',
        data: createEmptyStorageBreakdown(
          profileId,
          t('errors.profileNotFound')
        ),
      });
      return;
    }

    const breakdown = await this.getStorageBreakdown(
      profileId,
      profile.userDataDir
    );

    await this.callbacks.postMessage({
      type: 'storageInfo',
      data: breakdown,
    });
  }

  private async handleCleanStorage(
    profileId: string,
    options: StorageCleanupOptions
  ): Promise<void> {
    extensionLog.info(
      `[AccountsPanel] Storage cleanup requested for ${profileId}: ${options.action}`
    );

    const result = await this.deps.storageCleanupService.cleanProfileStorage(
      profileId,
      options
    );

    await this.callbacks.postMessage({
      type: 'storageCleanupResult',
      data: result,
    });

    if (result.success) {
      const profile = await this.deps.profileManager.getProfile(profileId);
      if (profile) {
        const breakdown = await this.getStorageBreakdown(
          profileId,
          profile.userDataDir
        );
        await this.callbacks.postMessage({
          type: 'storageInfo',
          data: breakdown,
        });
      }
    }
  }

  private async handleExport(
    profileIds: string[],
    includeSettings: boolean
  ): Promise<void> {
    extensionLog.info(
      `[AccountsPanel] Export requested (${profileIds.length} profile(s), settings=${includeSettings})`
    );
    const exporter = new ProfileExporter(this.deps.profileManager);
    const exportData = await exporter.exportProfiles(
      profileIds,
      includeSettings
    );
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

  private async handleImport(
    json: string,
    options: ImportOptions
  ): Promise<void> {
    extensionLog.info('[AccountsPanel] Import requested');
    const importer = new ProfileImporter(this.deps.profileManager);
    const result = await importer.importFromString(json, options);

    const messages: string[] = [];
    if (result.imported.length > 0) {
      messages.push(t('panel.imported', { count: result.imported.length }));
    }
    if (result.skipped.length > 0) {
      messages.push(t('panel.importSkipped', { count: result.skipped.length }));
    }
    if (result.errors.length > 0) {
      messages.push(t('panel.importErrors', { count: result.errors.length }));
    }

    if (result.imported.length > 0 || result.skipped.length > 0) {
      await this.callbacks.refresh();
    }

    if (result.success) {
      await this.callbacks.postMessage({
        type: 'success',
        message: messages.join(', ') || t('panel.importCompleted'),
      });
    } else {
      await this.callbacks.postMessage({
        type: 'error',
        message:
          messages.join(', ') || t('panel.importCompletedWithErrors'),
      });
    }
  }

  private async handleConfigureGithubToken(profileId: string): Promise<void> {
    const profile = await this.deps.profileManager.getProfile(profileId);
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
    await this.deps.profileManager.updateProfile(profileId, {
      githubTokenPath: tokenPath,
    });

    await this.callbacks.postMessage({
      type: 'success',
      message: t('panel.githubTokenConfigured', { name: profile.displayName }),
    });
    await this.callbacks.refreshGithubSummaries();
  }

  private async handleClearGithubToken(profileId: string): Promise<void> {
    const profile = await this.deps.profileManager.getProfile(profileId);
    if (!profile) {
      return;
    }

    await this.deps.profileManager.updateProfile(profileId, {
      githubTokenPath: undefined,
    });

    await this.callbacks.postMessage({
      type: 'success',
      message: t('panel.githubTokenCleared', { name: profile.displayName }),
    });
    await this.callbacks.refreshGithubSummaries();
  }

}
