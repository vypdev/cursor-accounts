import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import * as extensionLog from '../logging/extensionLog';
import * as lifecycleLog from '../logging/webviewLifecycleLog';
import type { InstanceDetector } from '../profiles/instanceDetector';
import { instanceMapToRecord } from '../profiles/instanceDetector';
import type { ProfileDetector } from '../profiles/profileDetector';
import type { ProfileLauncher } from '../profiles/profileLauncher';
import type { ProfileManager } from '../profiles/profileManager';
import type {
  FromWebviewMessage,
  InitData,
  InstanceInfo,
  Profile,
  ProfileQuota,
  ToWebviewMessage,
  WorkspaceInfo,
} from '../profiles/types';
import type { ProfileWithWorkspaces } from '@cursor-accounts/types';
import type { MultiProfileQuotaService } from '../services/multiProfileQuotaService';
import { quotaMapToRecord } from '../services/multiProfileQuotaService';
import type { ProfileAccountFetcher } from '../services/profileAccountFetcher';
import { accountMapToRecord } from '../services/profileAccountFetcher';
import type { ProfileWorkspaceService } from '../services/profileWorkspaceService';
import {
  getOpenWorkspacePaths,
  isWorkspacePathOpen,
} from '../services/activeWorkspaceService';
import type { EfficiencyService } from '../modelEfficiency/efficiencyService';
import { getLocale, getWebviewMessages, isRtlLocale, t } from '../l10n';
import { AccountsPanelHandlers } from './accountsPanelHandlers';
import { NodeFileSystemService } from '../storage/nodeFileSystemService';
import { ProfileStorageAnalyzer } from '../storage/profileStorageAnalyzer';
import { SqliteCleanupService } from '../storage/sqliteCleanupService';
import { StorageCleanupService } from '../services/storageCleanupService';
import { VSCodeCacheService } from '../storage/vscodeCacheService';

/** Webview panel view type id. */
export const ACCOUNTS_PANEL_VIEW_ID = 'cursorAccounts.accountsPanel';

export class AccountsPanelProvider {
  public static readonly viewType = ACCOUNTS_PANEL_VIEW_ID;

  private panel?: vscode.WebviewPanel;
  private accountsFetchInFlight = false;
  private webviewRuntimeReady = false;
  private readonly handlers: AccountsPanelHandlers;

  public hasResolvedView(): boolean {
    return this.panel !== undefined;
  }

  private getActiveWebview(): vscode.Webview | undefined {
    return this.panel?.webview;
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileManager: ProfileManager,
    profileLauncher: ProfileLauncher,
    private readonly profileDetector: ProfileDetector,
    private readonly quotaService: MultiProfileQuotaService,
    private readonly accountFetcher: ProfileAccountFetcher,
    private readonly instanceDetector: InstanceDetector,
    private readonly profileWorkspaceService: ProfileWorkspaceService,
    efficiencyService: EfficiencyService,
    authReader: IProfileAuthReader
  ) {
    const fileSystem = new NodeFileSystemService();
    const storageAnalyzer = new ProfileStorageAnalyzer(fileSystem);
    const storageCleanupService = new StorageCleanupService({
      profileManager,
      profileDetector,
      instanceDetector,
      storageAnalyzer,
      cacheCleanup: new VSCodeCacheService({
        context,
        fileSystem,
        efficiencyService,
        isCurrentProfile: async (profileId) => {
          const current = await profileDetector.detectCurrentProfile();
          return current?.id === profileId;
        },
      }),
      databaseCleanup: new SqliteCleanupService({
        extensionPath: context.extensionPath,
        fileSystem,
      }),
    });

    this.handlers = new AccountsPanelHandlers(
      {
        profileManager,
        profileLauncher,
        profileDetector,
        efficiencyService,
        authReader,
        instanceDetector,
        storageCleanupService,
        storageAnalyzer,
        profileWorkspaceService,
      },
      {
        postMessage: (message) => this.postMessage(message),
        refresh: () => this.refresh(),
        refreshInstances: () => this.refreshInstances(),
        hasActiveWebview: () => this.getActiveWebview() !== undefined,
      }
    );

    this.quotaService.onRefresh((quotas) => {
      void this.postQuotas(quotas);
    });

    this.instanceDetector.onDetectionChange((instances) => {
      void this.postRunningInstances(instances);
    });

    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.refreshOpenWorkspaces();
      })
    );
  }

  private buildProfileWorkspaces(
    profilesWithWorkspaces: ProfileWithWorkspaces[],
    currentProfile: Profile | null,
    openPaths: string[]
  ): Record<string, WorkspaceInfo[]> {
    const profileWorkspaces: Record<string, WorkspaceInfo[]> = {};

    for (const profile of profilesWithWorkspaces) {
      profileWorkspaces[profile.id] = profile.workspaces.map((workspace) => ({
        ...workspace,
        isOpenInSession:
          currentProfile?.id === profile.id &&
          isWorkspacePathOpen(workspace.path, openPaths),
      }));
    }

    return profileWorkspaces;
  }

  /** Push updated open-workspace state when folders change in the active window. */
  public async refreshOpenWorkspaces(): Promise<void> {
    if (!this.getActiveWebview()) {
      return;
    }

    try {
      const openPaths = getOpenWorkspacePaths();
      const currentProfile = await this.profileDetector.detectCurrentProfile();
      const profilesWithWorkspaces =
        await this.profileWorkspaceService.getProfilesWithWorkspaces();
      const profileWorkspaces = this.buildProfileWorkspaces(
        profilesWithWorkspaces,
        currentProfile,
        openPaths
      );

      await this.postMessage({
        type: 'openWorkspaces',
        data: { paths: openPaths, profileWorkspaces },
      });
    } catch (error) {
      extensionLog.error(
        `[AccountsPanel] Failed to refresh open workspaces: ${extensionLog.formatError(error)}`
      );
    }
  }

  /** Open the accounts panel in the editor area. */
  public openPanel(): void {
    if (this.panel) {
      lifecycleLog.lifecycle('panel.reveal');
      this.panel.reveal(undefined, true);
      this.requestRefresh();
      return;
    }

    lifecycleLog.lifecycle('panel.open');
    extensionLog.debug('[AccountsPanel] Opening accounts panel in editor');

    const distRoot = vscode.Uri.file(
      path.join(this.context.extensionPath, 'webview-dist')
    );

    this.panel = vscode.window.createWebviewPanel(
      ACCOUNTS_PANEL_VIEW_ID,
      t('panel.title'),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [distRoot],
      }
    );

    this.webviewRuntimeReady = false;
    this.attachWebviewMessageListener(this.panel.webview);
    this.panel.webview.html = this.getHtmlContent(this.panel.webview);

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  /** Bring the existing panel to the foreground. */
  public reveal(): void {
    if (this.panel) {
      this.panel.reveal(undefined, true);
      this.requestRefresh();
    }
  }

  private attachWebviewMessageListener(webview: vscode.Webview): void {
    webview.onDidReceiveMessage((message: FromWebviewMessage) => {
      void this.handleMessage(message);
    });
  }

  /**
   * Refresh webview data.
   */
  public async refresh(): Promise<void> {
    if (!this.getActiveWebview()) {
      return;
    }

    try {
      const profiles = await this.profileManager.getProfiles();
      const currentProfile = await this.profileDetector.detectCurrentProfile();
      const cachedQuotas = this.quotaService.getAllCachedQuotas();
      const quotas = quotaMapToRecord(cachedQuotas);
      const runningInstances = instanceMapToRecord(
        await this.instanceDetector.detectRunningInstances()
      );

      const profilesWithWorkspaces =
        await this.profileWorkspaceService.getProfilesWithWorkspaces();
      const openPaths = getOpenWorkspacePaths();
      const profileWorkspaces = this.buildProfileWorkspaces(
        profilesWithWorkspaces,
        currentProfile,
        openPaths
      );

      const initData: InitData = {
        profiles,
        profileWorkspaces,
        currentProfile,
        quotas,
        profileAccounts: {},
        activeAccount: null,
        runningInstances,
        openWorkspacePaths: openPaths,
        locale: getLocale(),
        messages: getWebviewMessages(),
      };

      await this.postMessage({ type: 'init', data: initData });
      lifecycleLog.lifecycle('init.sent', { profileCount: profiles.length });

      void Promise.all([this.refreshQuotas(), this.refreshProfileAccounts()]);
    } catch (error) {
      extensionLog.error(
        `[AccountsPanel] Failed to refresh accounts panel: ${extensionLog.formatError(error)}`
      );
      await this.postMessage({
        type: 'error',
        message: t('errors.failedLoadProfiles'),
      });
    }
  }

  /** Refresh only running instance data. */
  public async refreshInstances(): Promise<void> {
    if (!this.getActiveWebview()) {
      return;
    }

    try {
      const runningInstances = await this.instanceDetector.detectRunningInstances();
      await this.postRunningInstances(runningInstances);
    } catch (error) {
      extensionLog.error(
        `[AccountsPanel] Failed to refresh instances: ${extensionLog.formatError(error)}`
      );
    }
  }

  /** Fetch live profile account data and push to webview. */
  public async refreshProfileAccounts(): Promise<void> {
    if (!this.getActiveWebview()) {
      return;
    }

    if (this.accountsFetchInFlight) {
      extensionLog.debug(
        '[AccountsPanel] Profile account fetch skipped (already in flight)'
      );
      return;
    }

    try {
      this.accountsFetchInFlight = true;
      await this.postMessage({ type: 'accountsLoading', data: true });

      const profiles = await this.profileManager.getProfiles();
      const currentProfile = await this.profileDetector.detectCurrentProfile();
      const userDataDir = this.profileDetector.getCurrentUserDataDir();

      const [accountMap, activeAccount] = await Promise.all([
        this.accountFetcher.fetchAllProfileAccounts(profiles),
        this.accountFetcher.fetchActiveWindowAccount(
          userDataDir,
          currentProfile?.id
        ),
      ]);

      await this.postMessage({
        type: 'profileAccounts',
        data: accountMapToRecord(accountMap),
      });
      await this.postMessage({
        type: 'activeAccount',
        data: activeAccount,
      });
    } catch (error) {
      extensionLog.error(
        `[AccountsPanel] Failed to refresh profile accounts: ${extensionLog.formatError(error)}`
      );
    } finally {
      this.accountsFetchInFlight = false;
      await this.postMessage({ type: 'accountsLoading', data: false });
    }
  }

  /** Fetch fresh quota data and push to webview. */
  public async refreshQuotas(): Promise<void> {
    if (!this.getActiveWebview()) {
      return;
    }

    try {
      const quotaMap = await this.quotaService.fetchAllQuotas();
      await this.postQuotas(quotaMap);
    } catch (error) {
      extensionLog.error(
        `[AccountsPanel] Failed to refresh quotas: ${extensionLog.formatError(error)}`
      );
    }
  }

  private async postQuotas(
    quotas: Map<string, ProfileQuota>
  ): Promise<void> {
    if (!this.getActiveWebview()) {
      return;
    }

    await this.postMessage({
      type: 'quotas',
      data: quotaMapToRecord(quotas),
    });
  }

  private async postRunningInstances(
    instances: Map<string, InstanceInfo>
  ): Promise<void> {
    if (!this.getActiveWebview()) {
      return;
    }

    await this.postMessage({
      type: 'runningInstances',
      data: instanceMapToRecord(instances),
    });
  }

  /**
   * Handle messages from webview.
   */
  private async handleMessage(message: FromWebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          lifecycleLog.lifecycle('message.in', { type: 'ready' });
          this.webviewRuntimeReady = true;
          await delay(150);
          await this.refresh();
          lifecycleLog.lifecycle('ready.handled');
          break;

        case 'requestInit':
          lifecycleLog.lifecycle('message.in', { type: 'requestInit' });
          await this.refresh();
          break;

        case 'refresh':
          lifecycleLog.lifecycle('message.in', { type: 'refresh' });
          await this.refresh();
          break;

        case 'webviewLog':
          lifecycleLog.fromWebview(message.level, message.message, message.phase);
          break;

        default:
          if (this.isActionMessage(message)) {
            await this.handlers.handle(message);
          } else {
            const unknown = message as { type?: string };
            extensionLog.warn(
              `[AccountsPanel] Unknown webview message type: ${unknown.type ?? 'undefined'}`
            );
          }
      }
    } catch (error) {
      await this.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : t('errors.unknown'),
      });
    }
  }

  private requestRefresh(): void {
    if (this.webviewRuntimeReady) {
      void this.refresh();
    }
  }

  private isActionMessage(
    message: FromWebviewMessage
  ): message is Exclude<
    FromWebviewMessage,
    | { type: 'ready' }
    | { type: 'requestInit' }
    | { type: 'refresh' }
    | { type: 'webviewLog' }
  > {
    return (
      message.type !== 'ready' &&
      message.type !== 'requestInit' &&
      message.type !== 'refresh' &&
      message.type !== 'webviewLog'
    );
  }

  private async postMessage(message: ToWebviewMessage): Promise<void> {
    const webview = this.getActiveWebview();
    if (webview) {
      await webview.postMessage(message);
    }
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const distDir = path.join(this.context.extensionPath, 'webview-dist');
    const bundleJsPath = path.join(distDir, 'bundle.js');

    if (!fs.existsSync(bundleJsPath)) {
      extensionLog.error(
        `[AccountsPanel] bundle.js not found at: ${bundleJsPath}`
      );
      lifecycleLog.lifecycle('html.bundle-missing', { path: bundleJsPath });
    }

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(bundleJsPath)
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(distDir, 'bundle.css'))
    );

    const nonce = getNonce();
    const cspSource = webview.cspSource.toString();

    const locale = getLocale();
    const dir = isRtlLocale(locale) ? 'rtl' : 'ltr';

    return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'nonce-${nonce}'; font-src ${cspSource}; img-src ${cspSource} https:;">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>${t('panel.title')}</title>
</head>
<body>
  <div id="root">
    <p style="padding: 12px; color: var(--vscode-foreground, #ccc); font-family: var(--vscode-font-family, sans-serif);">
      ${t('panel.loadingHtml')}
    </p>
  </div>
  <script nonce="${nonce}">
    window.__cursorAccountsReportScriptError = function() {
      var root = document.getElementById('root');
      if (root) {
        root.innerHTML = '<p style="padding:12px;color:var(--vscode-errorForeground,#88);">${t('panel.scriptLoadFailed')}</p>';
      }
    };
    (function() {
      function reportLog(phase, message, level) {
        try {
          window.__cursorAccountsVscodeApi.postMessage({
            type: 'webviewLog',
            level: level || 'info',
            phase: phase,
            message: message
          });
        } catch (error) {
          console.error('[Webview] reportLog failed', phase, error);
        }
      }

      if (!window.__cursorAccountsVscodeApi) {
        window.__cursorAccountsVscodeApi = acquireVsCodeApi();
      }
      reportLog('bootstrap.api-acquired', 'acquireVsCodeApi completed');

      function waitForServiceWorker() {
        return new Promise(function(resolve) {
          if (!navigator.serviceWorker) {
            reportLog('bootstrap.sw-wait-end', 'no service worker support', 'debug');
            resolve('no-service-worker');
            return;
          }

          reportLog('bootstrap.sw-wait-start', 'waiting for controllerchange or timeout');

          var settled = false;
          function finish(reason) {
            if (settled) {
              return;
            }
            settled = true;
            reportLog('bootstrap.sw-wait-end', reason, 'debug');
            resolve(reason);
          }

          function onControllerChange() {
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
            finish('controllerchange');
          }

          navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
          window.setTimeout(function() {
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
            finish(
              navigator.serviceWorker.controller
                ? 'timeout-with-controller'
                : 'timeout-no-controller'
            );
          }, 2000);
        });
      }

      function sendReady() {
        reportLog('bootstrap.ready-send', 'postMessage ready');
        window.__cursorAccountsVscodeApi.postMessage({ type: 'ready' });
        reportLog('bootstrap.ready-sent', 'ready message sent');
      }

      waitForServiceWorker()
        .then(sendReady)
        .catch(function(error) {
          reportLog('bootstrap.error', String(error), 'info');
          sendReady();
        });
    })();
  </script>
  <script nonce="${nonce}" src="${scriptUri.toString()}" onerror="window.__cursorAccountsReportScriptError && window.__cursorAccountsReportScriptError()"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
