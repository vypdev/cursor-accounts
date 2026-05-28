import * as path from 'path';
import * as vscode from 'vscode';
import { ProfileDetector } from '../profiles/profileDetector';
import { ProfileLauncher } from '../profiles/profileLauncher';
import { ProfileManager } from '../profiles/profileManager';
import {
  FromWebviewMessage,
  InitData,
  Profile,
  ProfileQuota,
  ToWebviewMessage,
} from '../profiles/types';
import {
  MultiProfileQuotaService,
  quotaMapToRecord,
} from '../services/multiProfileQuotaService';

export class AccountsPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'cursorQuota.accountsPanel';

  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileManager: ProfileManager,
    private readonly profileLauncher: ProfileLauncher,
    private readonly profileDetector: ProfileDetector,
    private readonly quotaService: MultiProfileQuotaService
  ) {
    this.quotaService.onRefresh((quotas) => {
      void this.postQuotas(quotas);
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

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (message: FromWebviewMessage) => {
        void this.handleMessage(message);
      },
      undefined,
      this.context.subscriptions
    );

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.refresh();
      }
    });
  }

  /**
   * Refresh webview data.
   */
  public async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }

    try {
      const profiles = await this.profileManager.getProfiles();
      const currentProfile = await this.profileDetector.detectCurrentProfile();
      const cachedQuotas = await this.quotaService.getAllCachedQuotas();
      const quotas = quotaMapToRecord(cachedQuotas);

      const initData: InitData = {
        profiles,
        currentProfile,
        quotas,
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

  /** Fetch fresh quota data and push to webview. */
  public async refreshQuotas(): Promise<void> {
    if (!this.view) {
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
    if (!this.view) {
      return;
    }

    await this.postMessage({
      type: 'quotas',
      data: quotaMapToRecord(quotas),
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

    await this.profileManager.deleteProfile(profileId);

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

  private async postMessage(message: ToWebviewMessage): Promise<void> {
    if (this.view) {
      await this.view.webview.postMessage(message);
    }
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const distDir = path.join(this.context.extensionPath, 'webview-dist');

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(distDir, 'bundle.js'))
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Cursor Accounts</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
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
