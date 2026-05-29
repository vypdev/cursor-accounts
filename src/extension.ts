import * as vscode from 'vscode';
import { LEGACY_SECRETS_KEYS, SECRETS_KEYS } from './auth/cursorPaths';
import { QuotaClient } from './api/quotaClient';
import { QuotaUsage } from './api/types';
import { TokenService } from './auth/tokenRefresh';
import { registerProfileCommands } from './commands/profileCommands';
import { affectsCursorAccountsConfig } from './config';
import * as extensionLog from './logging/extensionLog';
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

const LEGACY_SETTINGS_KEYS = [
  'refresh.enabled',
  'refresh.intervalSeconds',
  'statusBar.showIncluded',
  'statusBar.showTotal',
  'statusBar.showAccountEmail',
  'profiles.autoDetectRunning',
  'profiles.showProfileInStatusBar',
  'profiles.refreshAllInterval',
  'profiles.instanceDetectionInterval',
] as const;

function migrateSettingsFromCursorQuota(): number {
  const oldSection = vscode.workspace.getConfiguration('cursorQuota');
  const newSection = vscode.workspace.getConfiguration('cursorAccounts');
  let migratedCount = 0;

  for (const key of LEGACY_SETTINGS_KEYS) {
    const oldInspect = oldSection.inspect<unknown>(key);
    const newInspect = newSection.inspect<unknown>(key);
    if (!oldInspect) {
      continue;
    }

    if (
      newInspect?.globalValue === undefined &&
      oldInspect.globalValue !== undefined
    ) {
      void newSection.update(
        key,
        oldInspect.globalValue,
        vscode.ConfigurationTarget.Global
      );
      migratedCount += 1;
    }

    if (
      newInspect?.workspaceValue === undefined &&
      oldInspect.workspaceValue !== undefined
    ) {
      void newSection.update(
        key,
        oldInspect.workspaceValue,
        vscode.ConfigurationTarget.Workspace
      );
      migratedCount += 1;
    }

    if (
      newInspect?.workspaceFolderValue === undefined &&
      oldInspect.workspaceFolderValue !== undefined
    ) {
      void newSection.update(
        key,
        oldInspect.workspaceFolderValue,
        vscode.ConfigurationTarget.WorkspaceFolder
      );
      migratedCount += 1;
    }
  }

  return migratedCount;
}

async function migrateSecretsFromCursorQuota(
  context: vscode.ExtensionContext
): Promise<{ skipped: boolean; migratedTokenCount: number }> {
  const newAccess = await context.secrets.get(SECRETS_KEYS.accessToken);
  if (newAccess) {
    return { skipped: true, migratedTokenCount: 0 };
  }

  const oldAccess = await context.secrets.get(LEGACY_SECRETS_KEYS.accessToken);
  const oldRefresh = await context.secrets.get(
    LEGACY_SECRETS_KEYS.refreshToken
  );

  let migratedTokenCount = 0;
  if (oldAccess) {
    await context.secrets.store(SECRETS_KEYS.accessToken, oldAccess);
    migratedTokenCount += 1;
  }
  if (oldRefresh) {
    await context.secrets.store(SECRETS_KEYS.refreshToken, oldRefresh);
    migratedTokenCount += 1;
  }

  return { skipped: false, migratedTokenCount };
}

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

  multiProfileQuotaService = new MultiProfileQuotaService(
    context,
    profileManager
  );

  const profileAccountFetcher = new ProfileAccountFetcher(context);

  efficiencyService = new EfficiencyService(
    context,
    profileManager,
    profileDetector
  );

  const accountsPanel = new AccountsPanelProvider(
    context,
    profileManager,
    profileLauncher,
    profileDetector,
    multiProfileQuotaService,
    profileAccountFetcher,
    instanceDetector,
    efficiencyService
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
      const isEnterprise =
        cached?.membershipType === 'enterprise' ||
        cached?.displayMode === 'monthlySpend';

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
        'Open Cursor Settings and select the Usage section to view full quota details.'
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
