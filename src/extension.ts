import * as vscode from 'vscode';
import { QuotaClient } from './api/quotaClient';
import { ActivityLeaderboardService } from './api/activityLeaderboardService';
import { UserClient } from './api/userClient';
import type { QuotaUsage } from './domain';
import { isEnterpriseUsage } from './domain';
import { ProfileAuthReader } from './auth/profileAuthReader';
import { TokenService } from './auth/tokenRefresh';
import { registerProfileCommands } from './commands/profileCommands';
import { affectsCursorAccountsConfig } from './config';
import { initL10n, t } from './l10n';
import * as extensionLog from './logging/extensionLog';
import {
  migrateSecretsFromCursorQuota,
  migrateSettingsFromCursorQuota,
} from './migrations/cursorQuotaMigration';
import { InstanceDetector } from './profiles/instanceDetector';
import { ProfileDetector } from './profiles/profileDetector';
import { ProfileLauncher } from './profiles/profileLauncher';
import { ProfileManager } from './profiles/profileManager';
import { MultiProfileQuotaService } from './services/multiProfileQuotaService';
import { ProfileAccountFetcher } from './services/profileAccountFetcher';
import { RefreshService } from './services/refreshService';
import {
  ACCOUNTS_SIDEBAR_VIEW_ID,
  ACCOUNTS_VIEW_CONTAINER,
  AccountsPanelProvider,
} from './ui/accountsPanel';
import { StatusBarManager } from './ui/statusBarManager';
import { EfficiencyService } from './modelEfficiency/efficiencyService';

let refreshService: RefreshService | undefined;
let multiProfileQuotaService: MultiProfileQuotaService | undefined;
let efficiencyService: EfficiencyService | undefined;

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function focusAccountsSidebar(
  accountsPanel: AccountsPanelProvider,
  options: { allowEditorFallback?: boolean } = {}
): Promise<void> {
  if (accountsPanel.hasResolvedView()) {
    return;
  }

  const focusCommands = [
    `${ACCOUNTS_SIDEBAR_VIEW_ID}.focus`,
    `workbench.view.extension.${ACCOUNTS_VIEW_CONTAINER}`,
  ];

  for (const command of focusCommands) {
    try {
      await vscode.commands.executeCommand(command);
      await delay(200);
    } catch {
      // Command may not exist in all hosts.
    }

    if (accountsPanel.hasResolvedView()) {
      return;
    }
  }

  if (options.allowEditorFallback) {
    accountsPanel.openAsEditorPanel();
  }
}

export function activate(context: vscode.ExtensionContext): void {
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

  const profileManager = new ProfileManager();
  const profileDetector = new ProfileDetector(profileManager, context);
  const instanceDetector = new InstanceDetector(profileManager);
  const profileLauncher = new ProfileLauncher(profileManager, instanceDetector);

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

  efficiencyService = new EfficiencyService(
    context,
    profileManager,
    profileDetector,
    profileAuthReader
  );

  const accountsPanel = new AccountsPanelProvider(
    context,
    profileManager,
    profileLauncher,
    profileDetector,
    multiProfileQuotaService,
    profileAccountFetcher,
    instanceDetector,
    efficiencyService,
    profileAuthReader
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ACCOUNTS_SIDEBAR_VIEW_ID,
      accountsPanel,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
  );

  void profileManager.initialize().then(async () => {
    const profiles = await profileManager.getProfiles();
    extensionLog.info(
      `[Extension] ProfileManager initialized with ${profiles.length} profile(s)`
    );
    await efficiencyService?.initialize();
  }).catch((err) => {
    extensionLog.error(
      `[Extension] ProfileManager initialization failed: ${extensionLog.formatError(err)}`
    );
  });

  registerProfileCommands(
    context,
    profileManager,
    profileLauncher,
    profileDetector
  );

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
    vscode.commands.registerCommand('cursorAccounts.openAccounts', async () => {
      await focusAccountsSidebar(accountsPanel, {
        allowEditorFallback: true,
      });
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

  refreshService.start();

  void focusAccountsSidebar(accountsPanel);
}

export function deactivate(): void {
  extensionLog.info('[Extension] Cursor Accounts deactivated');
  refreshService = undefined;
  multiProfileQuotaService?.stop();
  multiProfileQuotaService = undefined;
  efficiencyService?.dispose();
  efficiencyService = undefined;
}
