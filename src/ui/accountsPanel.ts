import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IProxyCertificate } from '../domain/ports/IProxyCertificate';
import type { IProxyLifecycle } from '../domain/ports/IProxyLifecycle';
import type { IProxyOutput } from '../domain/ports/IProxyOutput';
import type { IProxyPanelRead } from '../domain/ports/IProxyPanelRead';
import * as extensionLog from '../logging/extensionLog';
import * as lifecycleLog from '../logging/webviewLifecycleLog';
import type { InstanceDetector } from '../profiles/instanceDetector';
import type { ProfileLauncher } from '../profiles/profileLauncher';
import type {
  FromWebviewMessage,
  ToWebviewMessage,
} from '../profiles/types';
import type { MultiProfileQuotaService } from '../services/multiProfileQuotaService';
import type { ProfileAccountFetcher } from '../services/profileAccountFetcher';
import type { ProfileWorkspaceService } from '../services/profileWorkspaceService';
import { hasActiveWorkspace } from '../services/activeWorkspaceService';
import { shouldAutoOpenAccountsPanel } from './accountsPanelStartup';
import type { EfficiencyService } from '../modelEfficiency/efficiencyService';
import { getLocale, isRtlLocale, t } from '../l10n';
import type { IProfileStorageAnalyzer } from '../domain/ports/IProfileStorageAnalyzer';
import type { IStorageCleanupService } from '../domain/ports/IStorageCleanupService';
import type { ProxySettingsService } from '../services/proxySettingsService';
import type { IProfileSettingsManager } from '../domain/ports/IProfileSettingsManager';
import { ProfileGitHubEnrichmentService } from '../github/profileGitHubEnrichmentService';
import { AccountsPanelHandlers } from './accountsPanelHandlers';
import { AccountsPanelBackgroundRefreshCoordinator } from './accountsPanelBackgroundRefreshCoordinator';
import { AccountsPanelDataRefresher } from './accountsPanelDataRefresher';
import { ModelPricingService } from '../services/modelPricingService';
import { CursorModelPricingProvider } from '../modelEfficiency/cursorModelPricingProvider';
import { StateDbModelCatalogRepository } from '../modelEfficiency/stateDbModelCatalogRepository';
import { buildAccountsPanelHtml } from './presentation/accountsPanelHtml';
import { AccountsPanelModelPricingHandler } from './accountsPanelModelPricingHandler';
import { AccountsPanelMessageRouter } from './accountsPanelMessageRouter';
import type { AccountsPanelActionMessage } from './accountsPanelMessageRouter';

/** Webview panel view type id. */
export const ACCOUNTS_PANEL_VIEW_ID = 'cursorAccounts.accountsPanel';

export class AccountsPanelProvider {
  public static readonly viewType = ACCOUNTS_PANEL_VIEW_ID;

  private panel?: vscode.WebviewPanel;
  private webviewRuntimeReady = false;
  private readonly handlers: AccountsPanelHandlers;
  private readonly dataRefresher: AccountsPanelDataRefresher;
  private readonly modelPricingService: ModelPricingService;
  private readonly modelPricingHandler: AccountsPanelModelPricingHandler;
  private readonly messageRouter: AccountsPanelMessageRouter;

  public hasResolvedView(): boolean {
    return this.panel !== undefined;
  }

  private getActiveWebview(): vscode.Webview | undefined {
    return this.panel?.webview;
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    profileManager: IProfileManager,
    profileLauncher: ProfileLauncher,
    private readonly profileDetector: IProfileDetector,
    private readonly quotaService: MultiProfileQuotaService,
    accountFetcher: ProfileAccountFetcher,
    private readonly instanceDetector: InstanceDetector,
    profileWorkspaceService: ProfileWorkspaceService,
    efficiencyService: EfficiencyService,
    authReader: IProfileAuthReader,
    storageCleanupService: IStorageCleanupService,
    storageAnalyzer: IProfileStorageAnalyzer,
    proxyManager: IProxyPanelRead & IProxyLifecycle & IProxyCertificate & IProxyOutput,
    proxySettingsService?: ProxySettingsService,
    profileSettingsManager?: IProfileSettingsManager
  ) {
    const pricingProvider = new CursorModelPricingProvider();
    const catalogRepository = new StateDbModelCatalogRepository();
    this.modelPricingService = new ModelPricingService(
      catalogRepository,
      pricingProvider
    );
    this.modelPricingHandler = new AccountsPanelModelPricingHandler(
      {
        profileDetector,
        modelPricingReader: this.modelPricingService,
        extensionPath: context.extensionPath,
      },
      {
        postMessage: (message) => this.postMessage(message),
      }
    );

    const backgroundRefresh = new AccountsPanelBackgroundRefreshCoordinator(
      {
        profileManager,
        profileDetector,
        quotaService,
        accountFetcher,
        profileWorkspaceService,
        githubEnrichment: new ProfileGitHubEnrichmentService(),
      },
      {
        postMessage: (message) => this.postMessage(message),
        hasActiveWebview: () => this.getActiveWebview() !== undefined,
      }
    );

    this.dataRefresher = new AccountsPanelDataRefresher(
      {
        profileManager,
        profileDetector,
        backgroundRefresh,
        quotaService,
        instanceDetector,
        profileWorkspaceService,
        efficiencyService,
        proxyManager,
        proxySettingsService,
      },
      {
        postMessage: (message) => this.postMessage(message),
        hasActiveWebview: () => this.getActiveWebview() !== undefined,
      }
    );

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
        proxyManager,
        profileSettingsManager,
      },
      {
        postMessage: (message) => this.postMessage(message),
        refresh: () => this.dataRefresher.refresh(),
        refreshInstances: () => this.dataRefresher.refreshInstances(),
        refreshGithubSummaries: () =>
          this.dataRefresher.refreshGithubSummaries(),
        refreshProxyStatus: (options) =>
          this.dataRefresher.refreshProxyStatus(options),
        hasActiveWebview: () => this.getActiveWebview() !== undefined,
      }
    );

    this.messageRouter = new AccountsPanelMessageRouter({
      setRuntimeReady: () => {
        this.webviewRuntimeReady = true;
      },
      refresh: () => this.refresh(),
      handleAction: (message: AccountsPanelActionMessage) =>
        this.handlers.handle(message),
      requestModelPricing: () => this.modelPricingHandler.handle(),
      postMessage: (message) => this.postMessage(message),
    });

    this.quotaService.onRefresh((quotas) => {
      void this.dataRefresher.postQuotas(quotas);
    });

    this.instanceDetector.onDetectionChange((instances) => {
      void this.dataRefresher.postRunningInstances(instances);
    });

    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.onWorkspaceFoldersChanged();
      })
    );
  }

  private async onWorkspaceFoldersChanged(): Promise<void> {
    await this.maybeAutoOpenPanelOnEmptyWorkspace();
    await this.dataRefresher.refreshOpenWorkspaces();
  }

  /** Open the panel when the active profile has no project open (e.g. last folder closed). */
  private async maybeAutoOpenPanelOnEmptyWorkspace(): Promise<void> {
    if (this.hasResolvedView()) {
      return;
    }

    try {
      const currentProfile = await this.profileDetector.detectCurrentProfile();
      if (shouldAutoOpenAccountsPanel(currentProfile, hasActiveWorkspace())) {
        this.openPanel();
        extensionLog.info(
          '[AccountsPanel] Opened panel after workspace became empty'
        );
      }
    } catch (error) {
      extensionLog.debug(
        `[AccountsPanel] Auto-open on empty workspace skipped: ${extensionLog.formatError(error)}`
      );
    }
  }

  /** Push updated open-workspace state when folders change in the active window. */
  public async refreshOpenWorkspaces(): Promise<void> {
    await this.dataRefresher.refreshOpenWorkspaces();
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

    this.panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) {
        void this.refreshProxyStatus({ checkCertificate: true });
      }
    });

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
      return this.messageRouter.handle(message);
    });
  }

  /**
   * Refresh webview data.
   */
  public async refresh(): Promise<void> {
    await this.dataRefresher.refresh();
  }

  /** Push latest proxy status to the webview. */
  public async refreshProxyStatus(options?: {
    checkCertificate?: boolean;
  }): Promise<void> {
    await this.dataRefresher.refreshProxyStatus(options);
  }

  /** Push latest efficiency stats to the webview. */
  public async postEfficiencyStats(): Promise<void> {
    await this.dataRefresher.postEfficiencyStats();
  }

  /** Refresh only running instance data. */
  public async refreshInstances(): Promise<void> {
    await this.dataRefresher.refreshInstances();
  }

  /** Fetch live profile account data and push to webview. */
  public async refreshProfileAccounts(): Promise<void> {
    await this.dataRefresher.refreshProfileAccounts();
  }

  /** Fetch GitHub repo metadata for recent projects and push to webview. */
  public async refreshGithubSummaries(): Promise<void> {
    await this.dataRefresher.refreshGithubSummaries();
  }

  /** Fetch fresh quota data and push to webview. */
  public async refreshQuotas(): Promise<void> {
    await this.dataRefresher.refreshQuotas();
  }

  private requestRefresh(): void {
    if (this.webviewRuntimeReady) {
      void this.refresh();
    }
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

    const cspSource = webview.cspSource.toString();

    const locale = getLocale();
    const dir = isRtlLocale(locale) ? 'rtl' : 'ltr';

    return buildAccountsPanelHtml({
      locale,
      direction: dir,
      cspSource,
      scriptUri: scriptUri.toString(),
      styleUri: styleUri.toString(),
      title: t('panel.title'),
      loadingMessage: t('panel.loadingHtml'),
      scriptLoadFailedMessage: t('panel.scriptLoadFailed'),
    });
  }
}
