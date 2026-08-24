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
import {
  ProxyOutputPresenter,
  getProxyOutputConfig,
} from './ui/presentation/proxyOutputPresenter';
import { TokenDetectorOutputPresenter } from './ui/presentation/tokenDetectorOutputPresenter';
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
import { SqliteActiveConversationRepository } from './cursor/sqliteActiveConversationRepository';
import { WorkspaceStateDbPathResolver } from './cursor/workspaceStateDbPathResolver';
import { ActiveConversationTracker } from './services/activeConversationTracker';
import { AgentLiveUsageStatusBar } from './ui/agentLiveUsageStatusBar';
import { ActiveConversationStatusBar } from './ui/activeConversationStatusBar';
import { StatusBarManager } from './ui/statusBarManager';
import { EfficiencyService } from './modelEfficiency/efficiencyService';
import { EfficiencyStatsStorage } from './modelEfficiency/efficiencyStatsStorage';
import { closeAllConnections } from './persistence/agentTrackingRepositoryFactory';

let refreshService: RefreshService | undefined;
let multiProfileQuotaService: MultiProfileQuotaService | undefined;
let efficiencyService: EfficiencyService | undefined;
let instanceDetectorRef: InstanceDetector | undefined;
let proxyManagerRef: ProxyManager | undefined;
let proxyOutputPresenterRef: ProxyOutputPresenter | undefined;
let tokenDetectorPresenterRef: TokenDetectorOutputPresenter | undefined;
let activationGeneration = 0;

export function activate(context: vscode.ExtensionContext): void {
  const currentGeneration = ++activationGeneration;
  const isCurrentActivation = (): boolean =>
    currentGeneration === activationGeneration;
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
    tokenDetectorPresenter,
    undefined,
    getProxyOutputConfig
  );
  proxyManagerRef = proxyManager;

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

  const workspaceStateDbPathResolver = new WorkspaceStateDbPathResolver(context);
  const activeConversationRepository = new SqliteActiveConversationRepository(
    context.extensionPath
  );
  const activeConversationTracker = new ActiveConversationTracker(
    activeConversationRepository,
    workspaceStateDbPathResolver
  );
  const activeConversationStatusBar = new ActiveConversationStatusBar(
    context,
    activeConversationTracker,
    async (conversationId, profileId) => {
      const resolvedProfileId =
        profileId ?? (await profileDetector.detectCurrentProfile())?.id;
      if (!resolvedProfileId) {
        return null;
      }
      const tracking = proxyManager.getAgentTrackingService(resolvedProfileId);
      if (!tracking) {
        return null;
      }
      return tracking.getConversationTokens(conversationId);
    }
  );
  activeConversationStatusBar.start();
  activeConversationTracker.start();
  proxyManager.onTraffic((summary) => {
    agentLiveUsageStatusBar.ingest(summary);
  });
  proxyManager.onConversationUsagePersisted(({ conversationId, profileId }) => {
    activeConversationStatusBar.notifyUsagePersisted(conversationId, profileId);
  });
  context.subscriptions.push({
    dispose: () => activeConversationTracker.stop(),
  });

  void (async () => {
    if (!isCurrentActivation()) {
      return;
    }
    await proxyManager.ensureTrafficTailer();
    if (!isCurrentActivation()) {
      proxyManager.dispose();
    }
  })().catch((error: unknown) => {
    extensionLog.debug(
      `[Extension] Initial traffic ingress unavailable: ${extensionLog.formatError(error)}`
    );
  });

  proxyManager.onStatusChange(() => {
    void accountsPanel.refreshProxyStatus();
  });

  lifecycleLog.lifecycle('activate.begin', {
    uiKind: vscode.env.uiKind,
    panelOpen: accountsPanel.hasResolvedView(),
    timestamp: activateTimestamp,
  });

  void profileManager.initialize().then(async () => {
    if (!isCurrentActivation()) {
      return;
    }
    const profiles = await profileManager.getProfiles();
    if (!isCurrentActivation()) {
      return;
    }
    extensionLog.info(
      `[Extension] ProfileManager initialized with ${profiles.length} profile(s)`
    );

    await efficiencyService?.initialize();

    const anyProxyEnabled = profiles.some((profile) =>
      isProfileProxyEnabled(profile)
    );
    if (anyProxyEnabled) {
      if (!isCurrentActivation()) {
        return;
      }
      const result = await proxyManager.ensureSharedProxy(profiles);
      if (!isCurrentActivation()) {
        proxyManager.dispose();
        return;
      }
      if (result.success) {
        extensionLog.info(
          `[Proxy] Shared proxy started on port ${result.port ?? 'unknown'}`
        );
        await proxyManager.ensureTrafficTailer();
        void accountsPanel.refreshProxyStatus();
      } else {
        extensionLog.warn(
          `[Proxy] Failed to start shared proxy: ${result.error ?? 'unknown'}`
        );
      }
    }

    const currentProfile = await profileDetector.detectCurrentProfile();

    if (currentProfile === null) {
      // Intentionally disabled: unassigned window does not imply no other
      // profile windows are active; restoring would wipe valid proxy settings.
      // const restoreResult =
      //   await proxyManager.restoreAllProfileProxySettings();
    } else if (isProfileProxyEnabled(currentProfile)) {
      await proxyManager.connectToExistingProxy(currentProfile.id);
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
    ),
    vscode.commands.registerCommand(
      'cursorAccounts.debug.copyActiveConversationId',
      async () => {
        const id =
          activeConversationStatusBar.getCurrentState()?.lastFocusedComposerId;
        if (!id) {
          vscode.window.showInformationMessage(
            t('activeConversation.copy.none')
          );
          return;
        }
        await vscode.env.clipboard.writeText(id);
        vscode.window.showInformationMessage(
          t('activeConversation.copy.success', { id: id.slice(0, 8) })
        );
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

  activationGeneration += 1;

  proxyManagerRef?.dispose();
  proxyManagerRef = undefined;
  
  // Close database connections first (may checkpoint WAL)
  await closeAllConnections();
  
  refreshService?.stop();
  refreshService = undefined;
  multiProfileQuotaService?.stop();
  multiProfileQuotaService = undefined;

  instanceDetectorRef?.stopAutoDetection();
  instanceDetectorRef = undefined;
  efficiencyService?.dispose();
  efficiencyService = undefined;
}
