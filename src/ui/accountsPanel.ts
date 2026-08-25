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
import { getProfileStateDbPath } from '../auth/cursorPaths';
import type {
  ModelPricingDisplayData,
  ModelWithPricing,
} from '@cursor-accounts/types';

/** Webview panel view type id. */
export const ACCOUNTS_PANEL_VIEW_ID = 'cursorAccounts.accountsPanel';

export class AccountsPanelProvider {
  public static readonly viewType = ACCOUNTS_PANEL_VIEW_ID;

  private panel?: vscode.WebviewPanel;
  private webviewRuntimeReady = false;
  private readonly handlers: AccountsPanelHandlers;
  private readonly dataRefresher: AccountsPanelDataRefresher;
  private readonly modelPricingService: ModelPricingService;

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
      void this.handleMessage(message);
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

        case 'requestModelPricing':
          await this.handleRequestModelPricing();
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
    | { type: 'requestModelPricing' }
  > {
    return (
      message.type !== 'ready' &&
      message.type !== 'requestInit' &&
      message.type !== 'refresh' &&
      message.type !== 'webviewLog' &&
      message.type !== 'requestModelPricing'
    );
  }

  private toModelPricingDisplayData(
    models: ModelWithPricing[]
  ): ModelPricingDisplayData[] {
    return models
      .filter((model) => model.pricing !== null)
      .map((model) => {
        const pricing = model.pricing!;
        return {
          modelId: pricing.modelId,
          displayName: model.displayName,
          provider: pricing.provider,
          inputPer1M: pricing.inputPer1M,
          outputPer1M: pricing.outputPer1M,
          cacheReadPer1M: pricing.cacheReadPer1M,
          cacheWritePer1M: pricing.cacheWritePer1M,
          notes: pricing.notes,
          variantName: model.variantName,
          parameters: model.parameters?.map((parameter) => ({
            id: parameter.id,
            value: parameter.value,
          })),
        };
      });
  }

  private async handleRequestModelPricing(): Promise<void> {
    try {
      const userDataDir = this.profileDetector.getCurrentUserDataDir();
      const stateDbPath = getProfileStateDbPath(userDataDir);
      const [allModels, enabledModels] = await Promise.all([
        this.modelPricingService.getModelsWithPricing(
          stateDbPath,
          this.context.extensionPath
        ),
        this.modelPricingService.getEnabledModelsWithPricing(
          stateDbPath,
          this.context.extensionPath
        ),
      ]);

      await this.postMessage({
        type: 'modelPricing',
        data: this.toModelPricingDisplayData(allModels),
        enabledModels: this.toModelPricingDisplayData(enabledModels),
      });
    } catch (error) {
      await this.postMessage({
        type: 'modelPricingError',
        error:
          error instanceof Error ? error.message : 'Failed to load model pricing',
      });
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
        root.textContent = '';
        var error = document.createElement('p');
        error.style.padding = '12px';
        error.style.color = 'var(--vscode-errorForeground, #88)';
        error.textContent = ${JSON.stringify(t('panel.scriptLoadFailed'))};
        root.appendChild(error);
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
