import * as vscode from 'vscode';
import * as path from 'path';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IProfileStorageAnalyzer } from '../domain/ports/IProfileStorageAnalyzer';
import type { IStorageCleanupService } from '../domain/ports/IStorageCleanupService';
import * as extensionLog from '../logging/extensionLog';
import { t } from '../l10n';
import type { EfficiencyService } from '../modelEfficiency/efficiencyService';
import { getEfficiencyWrongWindowMessage } from '../modelEfficiency/efficiencyService';
import type { InstanceDetector } from '../profiles/instanceDetector';
import type { ProfileLauncher } from '../profiles/profileLauncher';
import type {
  FromWebviewMessage,
  ToWebviewMessage,
} from '../profiles/types';
import type { ProfileDetector } from '../profiles/profileDetector';
import { resolveRecentProjectLaunch } from '../profiles/recentProjectLaunchRouter';
import type { ProfileWorkspaceService } from '../services/profileWorkspaceService';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import type { IProxyCertificate } from '../domain/ports/IProxyCertificate';
import type { IProxyLifecycle } from '../domain/ports/IProxyLifecycle';
import type { IProxyOutput } from '../domain/ports/IProxyOutput';
import { getOpenWorkspacePaths } from '../services/activeWorkspaceService';
import { buildSuggestedProfileResponse } from './suggestedProfile';
import { AccountsPanelProxyHandlers } from './accountsPanelProxyHandlers';
import { AccountsPanelStorageHandlers } from './accountsPanelStorageHandlers';
import { AccountsPanelProfileHandlers } from './accountsPanelProfileHandlers';
import { AccountsPanelGithubHandlers } from './accountsPanelGithubHandlers';

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
  profileManager: IProfileManager;
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
  private readonly storageHandlers: AccountsPanelStorageHandlers;
  private readonly profileHandlers: AccountsPanelProfileHandlers;
  private readonly githubHandlers: AccountsPanelGithubHandlers;

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
    this.storageHandlers = new AccountsPanelStorageHandlers(
      {
        profileReader: deps.profileManager,
        storageAnalyzer: deps.storageAnalyzer,
        storageCleanupService: deps.storageCleanupService,
      },
      {
        postMessage: (message) => callbacks.postMessage(message),
      }
    );
    this.profileHandlers = new AccountsPanelProfileHandlers(
      {
        profileManager: deps.profileManager,
        profileDetector: deps.profileDetector,
        instanceDetector: deps.instanceDetector,
        proxyManager: deps.proxyManager,
        profileSettingsManager: deps.profileSettingsManager,
      },
      {
        postMessage: (message) => callbacks.postMessage(message),
        refresh: () => callbacks.refresh(),
        refreshProxyStatus: (options) => callbacks.refreshProxyStatus(options),
      }
    );
    this.githubHandlers = new AccountsPanelGithubHandlers(
      { profileWriter: deps.profileManager },
      {
        postMessage: (message) => callbacks.postMessage(message),
        refreshGithubSummaries: () => callbacks.refreshGithubSummaries(),
      }
    );
  }

  async handle(message: FromWebviewMessage): Promise<void> {
    switch (message.type) {
      case 'launch':
        await this.handleLaunch(message.profileId, message.projectPath);
        break;

      case 'add':
        await this.profileHandlers.add(message);
        break;

      case 'edit':
        await this.profileHandlers.edit(message.profileId, message.updates);
        break;

      case 'delete':
        await this.profileHandlers.delete(message.profileId);
        break;

      case 'showInExplorer':
        await this.handleShowInExplorer(message.profileId);
        break;

      case 'export':
        await this.profileHandlers.exportProfiles(
          message.profileIds,
          message.includeSettings
        );
        break;

      case 'import':
        await this.profileHandlers.importProfiles(message.data, message.options);
        break;

      case 'requestSuggestedProfile':
        await this.handleRequestSuggestedProfile();
        break;

      case 'toggleEfficiency':
        await this.handleToggleEfficiency(message.profileId, message.enabled);
        break;

      case 'requestStorageInfo':
        await this.storageHandlers.requestInfo(message.profileId);
        break;

      case 'cleanStorage':
        await this.storageHandlers.clean(message.profileId, message.options);
        break;

      case 'configureGithubToken':
        await this.githubHandlers.configure(message.profileId);
        break;

      case 'clearGithubToken':
        await this.githubHandlers.clear(message.profileId);
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

}
