import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getProfileStateDbPath } from '../auth/cursorPaths';
import { readAuthFromStateDb } from '../auth/tokenReader';
import {
  instanceMapToRecord,
  InstanceDetector,
} from '../profiles/instanceDetector';
import { ProfileDetector } from '../profiles/profileDetector';
import { ProfileExporter } from '../profiles/profileExporter';
import { ProfileImporter } from '../profiles/profileImporter';
import { ProfileLauncher } from '../profiles/profileLauncher';
import { ProfileManager } from '../profiles/profileManager';
import {
  FromWebviewMessage,
  ImportOptions,
  InitData,
  InstanceInfo,
  Profile,
  ProfileQuota,
  ToWebviewMessage,
} from '../profiles/types';
import {
  MultiProfileQuotaService,
  quotaMapToRecord,
} from '../services/multiProfileQuotaService';
import { buildSuggestedProfileResponse } from './suggestedProfile';

/** Activity bar container id (must match package.json viewsContainers). */
export const ACCOUNTS_VIEW_CONTAINER = 'cursorQuota';
/** Webview view id (must match package.json views). */
export const ACCOUNTS_SIDEBAR_VIEW_ID = 'cursorQuota.accountsPanel';

export class AccountsPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = ACCOUNTS_SIDEBAR_VIEW_ID;

  private view?: vscode.WebviewView;
  private panel?: vscode.WebviewPanel;

  public hasResolvedView(): boolean {
    return this.view !== undefined || this.panel !== undefined;
  }

  private getActiveWebview(): vscode.Webview | undefined {
    return this.view?.webview ?? this.panel?.webview;
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileManager: ProfileManager,
    private readonly profileLauncher: ProfileLauncher,
    private readonly profileDetector: ProfileDetector,
    private readonly quotaService: MultiProfileQuotaService,
    private readonly instanceDetector: InstanceDetector
  ) {
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
        error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(
        `Cursor Quota: failed to load Accounts panel (${message})`
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

    const distRoot = vscode.Uri.file(
      path.join(this.context.extensionPath, 'webview-dist')
    );

    this.panel = vscode.window.createWebviewPanel(
      ACCOUNTS_SIDEBAR_VIEW_ID,
      'Cursor Accounts',
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
      const cachedQuotas = await this.quotaService.getAllCachedQuotas();
      const quotas = quotaMapToRecord(cachedQuotas);
      const runningInstances = instanceMapToRecord(
        await this.instanceDetector.detectRunningInstances()
      );

      const initData: InitData = {
        profiles,
        currentProfile,
        quotas,
        runningInstances,
      };

      await this.postMessage({ type: 'init', data: initData });

      void this.refreshQuotas();
    } catch (error) {
      console.error('Failed to refresh accounts panel:', error);
      await this.postMessage({
        type: 'error',
        message: 'Failed to load profiles',
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
      console.error('Failed to refresh instances:', error);
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
      console.error('Failed to refresh quotas:', error);
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
          await this.refresh();
          break;

        case 'refresh':
          await this.refresh();
          break;

        case 'launch':
          await this.handleLaunch(message.profileId);
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

        default: {
          const unknown = message as { type?: string };
          console.warn('Unknown message type:', unknown.type);
        }
      }
    } catch (error) {
      await this.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async handleLaunch(profileId: string): Promise<void> {
    const result = await this.profileLauncher.launch(profileId);

    if (result.success) {
      const profile = await this.profileManager.getProfile(profileId);
      await this.postMessage({
        type: 'success',
        message: `Launching ${profile?.displayName ?? 'profile'}...`,
      });
      await this.refresh();
      void this.refreshInstances();
    } else {
      await this.postMessage({
        type: 'error',
        message: result.error ?? 'Failed to launch profile',
      });
    }
  }

  private async handleAdd(
    data: Extract<FromWebviewMessage, { type: 'add' }>
  ): Promise<void> {
    const profile = await this.profileManager.createProfile({
      email: data.email,
      displayName: data.displayName,
      theme: data.theme,
      color: data.color,
    });

    await this.postMessage({
      type: 'success',
      message: `Profile "${profile.displayName}" created`,
    });
    await this.refresh();
  }

  private async handleEdit(
    profileId: string,
    updates: Partial<Profile>
  ): Promise<void> {
    const profile = await this.profileManager.updateProfile(profileId, updates);

    await this.postMessage({
      type: 'success',
      message: `Profile "${profile.displayName}" updated`,
    });
    await this.refresh();
  }

  private async handleDelete(profileId: string): Promise<void> {
    const profile = await this.profileManager.getProfile(profileId);
    const displayName = profile?.displayName ?? 'Unknown';

    await this.profileManager.deleteProfile(profileId, this.instanceDetector);

    await this.postMessage({
      type: 'success',
      message: `Profile "${displayName}" deleted`,
    });
    await this.refresh();
  }

  private async handleShowInExplorer(profileId: string): Promise<void> {
    const profile = await this.profileManager.getProfile(profileId);
    if (!profile) {
      throw new Error('Profile not found');
    }

    const uri = vscode.Uri.file(profile.userDataDir);
    await vscode.commands.executeCommand('revealFileInOS', uri);
  }

  private async handleRequestSuggestedProfile(): Promise<void> {
    if (!this.getActiveWebview()) {
      return;
    }

    try {
      const userDataDir = this.profileDetector.getCurrentUserDataDir();
      const stateDbPath = getProfileStateDbPath(userDataDir);

      const tokens = await readAuthFromStateDb(
        stateDbPath,
        this.context.extensionPath
      );

      const existing = tokens?.email
        ? await this.profileManager.findProfileByEmail(tokens.email)
        : undefined;

      await this.postMessage(
        buildSuggestedProfileResponse(tokens?.email, existing)
      );
    } catch (error) {
      console.error('Failed to detect current profile email:', error);

      if (this.getActiveWebview()) {
        await this.postMessage({
          type: 'suggestedProfile',
          email: undefined,
          displayName: undefined,
        });
      }
    }
  }

  private async handleExport(
    profileIds: string[],
    includeSettings: boolean
  ): Promise<void> {
    const exporter = new ProfileExporter(this.profileManager);
    const exportData = await exporter.exportProfiles(profileIds, includeSettings);
    const json = JSON.stringify(exportData, null, 2);
    const timestamp = new Date().toISOString().slice(0, 10);

    await this.postMessage({
      type: 'exportData',
      data: json,
      filename: `cursor-profiles-export-${timestamp}.json`,
    });

    await this.postMessage({
      type: 'success',
      message: `Exported ${exportData.profiles.length} profile(s)`,
    });
  }

  private async handleImport(
    json: string,
    options: ImportOptions
  ): Promise<void> {
    const importer = new ProfileImporter(this.profileManager);
    const result = await importer.importFromString(json, options);

    const messages: string[] = [];
    if (result.imported.length > 0) {
      messages.push(`Imported ${result.imported.length}`);
    }
    if (result.skipped.length > 0) {
      messages.push(`Skipped ${result.skipped.length}`);
    }
    if (result.errors.length > 0) {
      messages.push(`${result.errors.length} error(s)`);
    }

    if (result.imported.length > 0 || result.skipped.length > 0) {
      await this.refresh();
    }

    if (result.success) {
      await this.postMessage({
        type: 'success',
        message: messages.join(', ') || 'Import completed',
      });
    } else {
      await this.postMessage({
        type: 'error',
        message:
          messages.join(', ') ||
          'Import completed with errors',
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
      console.error('[AccountsPanel] bundle.js not found at:', bundleJsPath);
    }

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(bundleJsPath)
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(distDir, 'bundle.css'))
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>Cursor Accounts</title>
</head>
<body>
  <div id="root">
    <p style="padding: 12px; color: var(--vscode-foreground, #ccc); font-family: var(--vscode-font-family, sans-serif);">
      Loading Cursor Accounts…
    </p>
  </div>
  <script nonce="${nonce}">
    window.__cursorQuotaReportScriptError = function() {
      var root = document.getElementById('root');
      if (root) {
        root.innerHTML = '<p style="padding:12px;color:var(--vscode-errorForeground,#f88);">Failed to load Cursor Accounts UI script.</p>';
      }
    };
  </script>
  <script nonce="${nonce}" src="${scriptUri}" onerror="window.__cursorQuotaReportScriptError && window.__cursorQuotaReportScriptError()"></script>
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
