import * as vscode from 'vscode';
import { QuotaClient } from './api/quotaClient';
import { ActivityLeaderboardService } from './api/activityLeaderboardService';
import { UserClient } from './api/userClient';
import type { QuotaUsage } from './domain';
import { isEnterpriseUsage } from './domain';
import { ProfileAuthReader } from './auth/profileAuthReader';
import { TokenService } from './auth/tokenRefresh';
import { registerProfileCommands } from './commands/profileCommands';
import { registerProxyCommands } from './commands/proxyCommands';
import { ProxyStateFileStore } from './proxy/proxyStateFileStore';
import { getSharedProxyStorageDir } from './proxy/sharedProxyPaths';
import { ProxyOutputPresenter } from './proxy/proxyOutputPresenter';
import { TokenDetectorOutputPresenter } from './proxy/tokenDetectorOutputPresenter';
import { ProxyManager } from './services/proxyManager';
import { affectsCursorAccountsConfig } from './config';
import { initL10n, t } from './l10n';
import * as extensionLog from './logging/extensionLog';
import * as lifecycleLog from './logging/webviewLifecycleLog';
import {
  migrateSecretsFromCursorQuota,
  migrateSettingsFromCursorQuota,
} from './migrations/cursorQuotaMigration';
import { InstanceDetector } from './profiles/instanceDetector';
import { ProfileDetector } from './profiles/profileDetector';
import { ProfileLauncher } from './profiles/profileLauncher';
import { ProfileSettingsManager } from './profiles/profileSettingsManager';
import { ProxySettingsService } from './services/proxySettingsService';
import { createAccountsPanelStorageBundle } from './composition/createStorageServices';
import { ProfileManager } from './profiles/profileManager';
import { ProfileStorage } from './profiles/profileStorage';
import { WorkspaceScanner } from './profiles/workspaceScanner';
import { MultiProfileQuotaService } from './services/multiProfileQuotaService';
import { ProfileAccountFetcher } from './services/profileAccountFetcher';
import { ProfileWorkspaceService } from './services/profileWorkspaceService';
import { RefreshService } from './services/refreshService';
import { hasActiveWorkspace } from './services/activeWorkspaceService';
import { AccountsPanelProvider } from './ui/accountsPanel';
import { shouldAutoOpenAccountsPanel } from './ui/accountsPanelStartup';
import { isProfileProxyEnabled } from '@cursor-accounts/types';
import { AgentLiveUsageStatusBar } from './ui/agentLiveUsageStatusBar';
import { StatusBarManager } from './ui/statusBarManager';
import { EfficiencyService } from './modelEfficiency/efficiencyService';
import { EfficiencyStatsStorage } from './modelEfficiency/efficiencyStatsStorage';

let refreshService: RefreshService | undefined;
let multiProfileQuotaService: MultiProfileQuotaService | undefined;
let efficiencyService: EfficiencyService | undefined;
let instanceDetectorRef: InstanceDetector | undefined;
let proxyOutputPresenterRef: ProxyOutputPresenter | undefined;
let tokenDetectorPresenterRef: TokenDetectorOutputPresenter | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const activateTimestamp = lifecycleLog.markActivate();

  initL10n({
    extensionPath: context.extensionPath,
    language: vscode.env.language,
  });

  extensionLog.init(context);
  extensionLog.info('[Extension] Cursor Accounts activated');

  const settingsMigrated = migrateSettingsFromCursorQuota();
  if (settingsMigrated > 0) {
    extensionLog.info(
      `[Extension] Migrated ${settingsMigrated} setting value(s) from cursorQuota to cursorAccounts`
    );
  }

  void migrateSecretsFromCursorQuota(context).then((result) => {
    if (result.skipped) {
      extensionLog.debug(
        '[Extension] Secrets migration skipped (cursorAccounts tokens already present)'
      );
    } else if (result.migratedTokenCount > 0) {
      extensionLog.info(
        `[Extension] Migrated ${result.migratedTokenCount} secret(s) from cursorQuota to cursorAccounts`
      );
    }
  });

  const profileManager = new ProfileManager(new ProfileStorage());
  const profileDetector = new ProfileDetector(profileManager, context);
  const instanceDetector = new InstanceDetector(profileManager);
  instanceDetectorRef = instanceDetector;
  const sharedProxyDir = getSharedProxyStorageDir();
  const proxyStateStore = new ProxyStateFileStore();
  const profileSettingsManager = new ProfileSettingsManager();
  const proxySettingsService = new ProxySettingsService(
    profileManager,
    profileSettingsManager,
    instanceDetector
  );
  const proxyOutputPresenter = new ProxyOutputPresenter();
  proxyOutputPresenterRef = proxyOutputPresenter;
  const tokenDetectorPresenter = new TokenDetectorOutputPresenter();
  tokenDetectorPresenterRef = tokenDetectorPresenter;
  const proxyManager = new ProxyManager(
    proxyStateStore,
    profileManager,
    context,
    sharedProxyDir,
    proxySettingsService,
    profileSettingsManager,
    proxyOutputPresenter,
    tokenDetectorPresenter
  );

  const profileLauncher = new ProfileLauncher(
    profileManager,
    instanceDetector,
    proxyManager,
    profileSettingsManager
  );
  const workspaceScanner = new WorkspaceScanner();
  const profileWorkspaceService = new ProfileWorkspaceService(
    profileManager,
    workspaceScanner
  );

  const profileAuthReader = new ProfileAuthReader(context);

  multiProfileQuotaService = new MultiProfileQuotaService(
    context,
    profileManager,
    profileAuthReader,
    (provider) => new QuotaClient(provider),
    new ActivityLeaderboardService()
  );

  const profileAccountFetcher = new ProfileAccountFetcher(
    profileAuthReader,
    new UserClient()
  );

  const efficiencyStatsStorage = new EfficiencyStatsStorage(
    context.extensionPath
  );

  efficiencyService = new EfficiencyService(
    context,
    profileManager,
    profileDetector,
    profileAuthReader,
    efficiencyStatsStorage,
    multiProfileQuotaService
  );

  const storageBundle = createAccountsPanelStorageBundle({
    context,
    profileManager,
    profileDetector,
    instanceDetector,
    efficiencyService,
  });

  const accountsPanel = new AccountsPanelProvider(
    context,
    profileManager,
    profileLauncher,
    profileDetector,
    multiProfileQuotaService,
    profileAccountFetcher,
    instanceDetector,
    profileWorkspaceService,
    efficiencyService,
    profileAuthReader,
    storageBundle.storageCleanupService,
    storageBundle.storageAnalyzer,
    proxyManager,
    proxySettingsService,
    profileSettingsManager
  );

  efficiencyStatsStorage.setStatsUpdatedListener(() => {
    void accountsPanel.postEfficiencyStats();
  });

  const agentLiveUsageStatusBar = new AgentLiveUsageStatusBar(context);
  proxyManager.onTraffic((summary) => {
    agentLiveUsageStatusBar.ingest(summary);
  });

  void proxyManager.ensureTrafficTailer();

  proxyManager.onStatusChange(() => {
    void accountsPanel.refreshProxyStatus();
  });

  lifecycleLog.lifecycle('activate.begin', {
    uiKind: vscode.env.uiKind,
    panelOpen: accountsPanel.hasResolvedView(),
    timestamp: activateTimestamp,
  });

  void profileManager.initialize().then(async () => {
    const profiles = await profileManager.getProfiles();
    extensionLog.info(
      `[Extension] ProfileManager initialized with ${profiles.length} profile(s)`
    );

    await efficiencyService?.initialize();

    const currentProfile = await profileDetector.detectCurrentProfile();

    if (currentProfile === null) {
      const restoreResult =
        await proxyManager.restoreAllProfileProxySettings();
      if (restoreResult.restored > 0) {
        extensionLog.info(
          `[Proxy] Restored proxy settings on ${restoreResult.restored} profile(s) (unassigned window)`
        );
      }
      if (restoreResult.errors.length > 0) {
        extensionLog.warn(
          `[Proxy] Failed to restore proxy settings on ${restoreResult.errors.length} profile(s)`
        );
      }
    } else if (isProfileProxyEnabled(currentProfile)) {
      const result = await proxyManager.ensureProfileProxy(currentProfile.id);
      if (result.success) {
        extensionLog.info(
          `[Proxy] Ensured proxy for profile ${currentProfile.displayName} on port ${result.port ?? 'unknown'}`
        );
        await proxyManager.ensureTrafficTailer();
        void accountsPanel.refreshProxyStatus();
      } else {
        extensionLog.warn(
          `[Proxy] Failed to ensure proxy for ${currentProfile.displayName}: ${result.error ?? 'unknown'}`
        );
      }
    }

    const workspaceOpen = hasActiveWorkspace();
    if (shouldAutoOpenAccountsPanel(currentProfile, workspaceOpen)) {
      accountsPanel.openPanel();
      if (currentProfile === null) {
        extensionLog.info('[Extension] Unassigned window - accounts panel opened');
        lifecycleLog.lifecycle('panel.startup-open.unassigned', {
          panelOpen: accountsPanel.hasResolvedView(),
          sinceActivateMs: lifecycleLog.sinceActivateMs(),
        });
      } else {
        extensionLog.info(
          `[Extension] Profile ${currentProfile.displayName} active with no project - accounts panel opened`
        );
        lifecycleLog.lifecycle('panel.startup-open.no-workspace', {
          profileId: currentProfile.id,
          panelOpen: accountsPanel.hasResolvedView(),
          sinceActivateMs: lifecycleLog.sinceActivateMs(),
        });
      }
    } else if (currentProfile) {
      extensionLog.info(
        `[Extension] Profile ${currentProfile.displayName} has an open project - panel not auto-opened`
      );
    }
  }).catch((err) => {
    extensionLog.error(
      `[Extension] ProfileManager initialization failed: ${extensionLog.formatError(err)}`
    );
  });

  registerProfileCommands(
    context,
    profileManager,
    profileLauncher,
    profileDetector,
    instanceDetector
  );

  registerProxyCommands(context, proxyManager, profileDetector, () => {
    void accountsPanel.refreshProxyStatus();
  });

  const profilesConfig = vscode.workspace.getConfiguration(
    'cursorAccounts.profiles'
  );
  const refreshAllInterval = profilesConfig.get<number>(
    'refreshAllInterval',
    300
  );
  multiProfileQuotaService.start(refreshAllInterval);
  extensionLog.info(
    `[Extension] MultiProfileQuotaService started (interval ${refreshAllInterval}s)`
  );

  if (profilesConfig.get<boolean>('autoDetectRunning', true)) {
    const detectionIntervalSeconds = profilesConfig.get<number>(
      'instanceDetectionInterval',
      30
    );
    instanceDetector.startAutoDetection(detectionIntervalSeconds * 1000);
    extensionLog.info(
      `[Extension] InstanceDetector auto-detection started (interval ${detectionIntervalSeconds}s)`
    );
  } else {
    extensionLog.debug(
      '[Extension] InstanceDetector auto-detection disabled by configuration'
    );
  }

  context.subscriptions.push({
    dispose: () => multiProfileQuotaService?.stop(),
  });

  context.subscriptions.push({
    dispose: () => instanceDetector.stopAutoDetection(),
  });

  const statusBar = new StatusBarManager(context, profileDetector);
  statusBar.showOnActivate();

  const tokenService = new TokenService(context, profileDetector);
  const quotaClient = new QuotaClient(tokenService);

  refreshService = new RefreshService(
    context,
    quotaClient,
    (usage) => statusBar.render(usage),
    (message) => statusBar.showError(message)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (affectsCursorAccountsConfig(event)) {
        statusBar.applyVisibilityFromConfig();
      }
    }),
    vscode.commands.registerCommand('cursorAccounts.openAccounts', () => {
      if (accountsPanel.hasResolvedView()) {
        accountsPanel.reveal();
      } else {
        accountsPanel.openPanel();
      }
    }),
    vscode.commands.registerCommand('cursorAccounts.refresh', async () => {
      await refreshService?.tickNow();
    }),
    vscode.commands.registerCommand('cursorAccounts.openUsage', async () => {
      const cached = context.globalState.get<QuotaUsage>('lastQuota');
      const isEnterprise = cached != null && isEnterpriseUsage(cached);

      if (isEnterprise) {
        await vscode.env.openExternal(
          vscode.Uri.parse('https://cursor.com/dashboard/usage')
        );
        return;
      }

      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@id:cursor'
      );
      vscode.window.showInformationMessage(
        t('commands.openUsage.message')
      );
    }),
    vscode.commands.registerCommand(
      'cursorAccounts.efficiency.showOutput',
      () => {
        efficiencyService?.getOutputPresenter().show();
      }
    ),
    vscode.commands.registerCommand(
      'cursorAccounts.efficiency.restartDetector',
      async () => {
        await efficiencyService?.restartPromptDetector();
      }
    )
  );

  context.subscriptions.push({
    dispose: () => efficiencyService?.dispose(),
  });
  context.subscriptions.push({
    dispose: () => {
      proxyOutputPresenterRef?.dispose();
      proxyOutputPresenterRef = undefined;
      tokenDetectorPresenterRef?.dispose();
      tokenDetectorPresenterRef = undefined;
    },
  });

  refreshService.start();
}

export async function deactivate(): Promise<void> {
  extensionLog.info('[Extension] Cursor Accounts deactivated');
  refreshService?.stop();
  refreshService = undefined;
  multiProfileQuotaService?.stop();
  multiProfileQuotaService = undefined;

  instanceDetectorRef?.stopAutoDetection();
  instanceDetectorRef = undefined;
  efficiencyService?.dispose();
  efficiencyService = undefined;
}
