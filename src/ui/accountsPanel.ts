import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import * as extensionLog from '../logging/extensionLog';
import type { InstanceDetector } from '../profiles/instanceDetector';
import { instanceMapToRecord } from '../profiles/instanceDetector';
import type { ProfileDetector } from '../profiles/profileDetector';
import type { ProfileLauncher } from '../profiles/profileLauncher';
import type { ProfileManager } from '../profiles/profileManager';
import type {
  FromWebviewMessage,
  InitData,
  InstanceInfo,
  ProfileQuota,
  ToWebviewMessage,
} from '../profiles/types';
import type { MultiProfileQuotaService } from '../services/multiProfileQuotaService';
import { quotaMapToRecord } from '../services/multiProfileQuotaService';
import type { ProfileAccountFetcher } from '../services/profileAccountFetcher';
import { accountMapToRecord } from '../services/profileAccountFetcher';
import type { EfficiencyService } from '../modelEfficiency/efficiencyService';
import { getLocale, getWebviewMessages, isRtlLocale, t } from '../l10n';
import { AccountsPanelHandlers } from './accountsPanelHandlers';
import { NodeFileSystemService } from '../storage/nodeFileSystemService';
import { ProfileStorageAnalyzer } from '../storage/profileStorageAnalyzer';
import { SqliteCleanupService } from '../storage/sqliteCleanupService';
import { StorageCleanupService } from '../services/storageCleanupService';
import { VSCodeCacheService } from '../storage/vscodeCacheService';

/** Activity bar container id (must match package.json viewsContainers). */
export const ACCOUNTS_VIEW_CONTAINER = 'cursorAccounts';
/** Webview view id (must match package.json views). */
export const ACCOUNTS_SIDEBAR_VIEW_ID = 'cursorAccounts.accountsPanel';

export class AccountsPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = ACCOUNTS_SIDEBAR_VIEW_ID;

  private view?: vscode.WebviewView;
  private panel?: vscode.WebviewPanel;
  private accountsFetchInFlight = false;
  private readonly handlers: AccountsPanelHandlers;

  public hasResolvedView(): boolean {
    return this.view !== undefined || this.panel !== undefined;
  }

  private getActiveWebview(): vscode.Webview | undefined {
    return this.view?.webview ?? this.panel?.webview;
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileManager: ProfileManager,
    profileLauncher: ProfileLauncher,
    private readonly profileDetector: ProfileDetector,
    private readonly quotaService: MultiProfileQuotaService,
    private readonly accountFetcher: ProfileAccountFetcher,
    private readonly instanceDetector: InstanceDetector,
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
  }

  /**
   * Called when webview becomes visible.
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    extensionLog.debug('[AccountsPanel] Webview resolved (sidebar)');

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(
          path.join(this.context.extensionPath, 'webview-dist')
        ),
      ],
    };

    this.attachWebviewMessageListener(webviewView.webview);

    try {
      webviewView.webview.html = this.getHtmlContent(webviewView.webview);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('errors.unknown');
      vscode.window.showErrorMessage(
        t('panel.loadFailed', { error: message })
      );
      throw error;
    }

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.refresh();
      }
    });
  }

  /** Fallback when the sidebar webview never resolves (Cursor/VS Code race). */
  public openAsEditorPanel(): void {
    if (this.panel) {
      this.panel.reveal(undefined, true);
      void this.refresh();
      return;
    }

    extensionLog.debug('[AccountsPanel] Webview resolved (editor panel fallback)');

    const distRoot = vscode.Uri.file(
      path.join(this.context.extensionPath, 'webview-dist')
    );

    this.panel = vscode.window.createWebviewPanel(
      ACCOUNTS_SIDEBAR_VIEW_ID,
      t('panel.title'),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [distRoot],
      }
    );

    this.attachWebviewMessageListener(this.panel.webview);
    this.panel.webview.html = this.getHtmlContent(this.panel.webview);

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
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

      const initData: InitData = {
        profiles,
        currentProfile,
        quotas,
        profileAccounts: {},
        activeAccount: null,
        runningInstances,
        locale: getLocale(),
        messages: getWebviewMessages(),
      };

      await this.postMessage({ type: 'init', data: initData });

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
        case 'refresh':
          await this.refresh();
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

  private isActionMessage(
    message: FromWebviewMessage
  ): message is Exclude<
    FromWebviewMessage,
    { type: 'ready' } | { type: 'refresh' }
  > {
    return message.type !== 'ready' && message.type !== 'refresh';
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
        root.innerHTML = '<p style="padding:12px;color:var(--vscode-errorForeground,#f88);">${t('panel.scriptLoadFailed')}</p>';
      }
    };
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
