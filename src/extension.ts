import * as vscode from 'vscode';
import type { QuotaUsage } from './domain';
import { isEnterpriseUsage } from './domain';
import { registerProfileCommands } from './commands/profileCommands';
import { registerProxyCommands } from './commands/proxyCommands';
import { affectsCursorAccountsConfig } from './config';
import { initL10n, t } from './l10n';
import * as extensionLog from './logging/extensionLog';
import * as lifecycleLog from './logging/webviewLifecycleLog';
import {
  migrateSecretsFromCursorQuota,
  migrateSettingsFromCursorQuota,
} from './migrations/cursorQuotaMigration';
import { hasActiveWorkspace } from './services/activeWorkspaceService';
import { shouldAutoOpenAccountsPanel } from './ui/accountsPanelStartup';
import { isProfileProxyEnabled } from '@cursor-accounts/types';
import { closeAllConnections } from './persistence/agentTrackingRepositoryFactory';
import {
  createExtensionRuntime,
  type ExtensionActivationDependencies,
  type ExtensionRuntime,
} from './composition/createExtensionRuntime';

export type { ExtensionActivationDependencies } from './composition/createExtensionRuntime';

let refreshService: ExtensionRuntime['refreshService'] | undefined;
let multiProfileQuotaService: ExtensionRuntime['multiProfileQuotaService'] | undefined;
let efficiencyService: ExtensionRuntime['efficiencyService'] | undefined;
let instanceDetectorRef: ExtensionRuntime['instanceDetector'] | undefined;
let proxyManagerRef: ExtensionRuntime['proxyManager'] | undefined;
let proxyOutputPresenterRef: ExtensionRuntime['proxyOutputPresenter'] | undefined;
let tokenDetectorPresenterRef: ExtensionRuntime['tokenDetectorPresenter'] | undefined;
let activationGeneration = 0;
let activationInitialization: Promise<void> | undefined;

export function activate(
  context: vscode.ExtensionContext,
  dependencies: ExtensionActivationDependencies = {}
): void {
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

  const runtime = createExtensionRuntime(context, dependencies);
  const {
    profileManager,
    profileDetector,
    instanceDetector,
    proxyManager,
    profileLauncher,
    multiProfileQuotaService: runtimeQuotaService,
    efficiencyService: runtimeEfficiencyService,
    efficiencyStatsStorage,
    accountsPanel,
    agentLiveUsageStatusBar,
    activeConversationTracker,
    activeConversationStatusBar,
    statusBar,
    refreshService: runtimeRefreshService,
    proxyOutputPresenter,
    tokenDetectorPresenter,
  } = runtime;

  multiProfileQuotaService = runtimeQuotaService;
  efficiencyService = runtimeEfficiencyService;
  refreshService = runtimeRefreshService;
  instanceDetectorRef = instanceDetector;
  proxyOutputPresenterRef = proxyOutputPresenter;
  tokenDetectorPresenterRef = tokenDetectorPresenter;
  proxyManagerRef = proxyManager;

  efficiencyStatsStorage.setStatsUpdatedListener(() => {
    void accountsPanel.postEfficiencyStats();
  });
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

  activationInitialization = profileManager.initialize().then(async () => {
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

  statusBar.showOnActivate();

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

  runtimeRefreshService.start();
}

export async function deactivate(): Promise<void> {
  extensionLog.info('[Extension] Cursor Accounts deactivated');

  activationGeneration += 1;
  const pendingInitialization = activationInitialization;
  activationInitialization = undefined;

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

  await pendingInitialization;
}
