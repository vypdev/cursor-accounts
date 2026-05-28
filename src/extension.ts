import * as vscode from 'vscode';
import { QuotaClient } from './api/quotaClient';
import { TokenService } from './auth/tokenRefresh';
import { registerProfileCommands } from './commands/profileCommands';
import { affectsCursorQuotaConfig } from './config';
import { InstanceDetector } from './profiles/instanceDetector';
import { ProfileDetector } from './profiles/profileDetector';
import { ProfileLauncher } from './profiles/profileLauncher';
import { ProfileManager } from './profiles/profileManager';
import { MultiProfileQuotaService } from './services/multiProfileQuotaService';
import { RefreshService } from './services/refreshService';
import { AccountsPanelProvider } from './ui/accountsPanel';
import { StatusBarManager } from './ui/statusBarManager';

let refreshService: RefreshService | undefined;
let multiProfileQuotaService: MultiProfileQuotaService | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const profileManager = new ProfileManager();
  const profileDetector = new ProfileDetector(profileManager, context);
  const instanceDetector = new InstanceDetector(profileManager);
  const profileLauncher = new ProfileLauncher(profileManager, instanceDetector);

  void profileManager.initialize().catch((err) => {
    console.error('Failed to initialize ProfileManager:', err);
  });

  registerProfileCommands(
    context,
    profileManager,
    profileLauncher,
    profileDetector
  );

  multiProfileQuotaService = new MultiProfileQuotaService(
    context,
    profileManager
  );

  const profilesConfig = vscode.workspace.getConfiguration(
    'cursorQuota.profiles'
  );
  const refreshAllInterval = profilesConfig.get<number>(
    'refreshAllInterval',
    300
  );
  multiProfileQuotaService.start(refreshAllInterval);

  if (profilesConfig.get<boolean>('autoDetectRunning', true)) {
    const detectionIntervalSeconds = profilesConfig.get<number>(
      'instanceDetectionInterval',
      30
    );
    instanceDetector.startAutoDetection(detectionIntervalSeconds * 1000);
  }

  const accountsPanel = new AccountsPanelProvider(
    context,
    profileManager,
    profileLauncher,
    profileDetector,
    multiProfileQuotaService,
    instanceDetector
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AccountsPanelProvider.viewType,
      accountsPanel
    ),
    {
      dispose: () => multiProfileQuotaService?.stop(),
    },
    {
      dispose: () => instanceDetector.stopAutoDetection(),
    }
  );

  const statusBar = new StatusBarManager(context, profileDetector);
  statusBar.showOnActivate();

  const tokenService = new TokenService(context);
  const quotaClient = new QuotaClient(tokenService);

  refreshService = new RefreshService(
    context,
    quotaClient,
    (usage) => statusBar.render(usage),
    (message) => statusBar.showError(message)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (affectsCursorQuotaConfig(event)) {
        statusBar.applyVisibilityFromConfig();
      }
    }),
    vscode.commands.registerCommand('cursorQuota.refresh', async () => {
      await refreshService?.tickNow();
    }),
    vscode.commands.registerCommand('cursorQuota.openUsage', async () => {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@id:cursor'
      );
      vscode.window.showInformationMessage(
        'Open Cursor Settings and select the Usage section to view full quota details.'
      );
    })
  );

  refreshService.start();
}

export function deactivate(): void {
  refreshService = undefined;
  multiProfileQuotaService?.stop();
  multiProfileQuotaService = undefined;
}
