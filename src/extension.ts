import * as vscode from 'vscode';
import { initL10n } from './l10n';
import * as extensionLog from './logging/extensionLog';
import * as lifecycleLog from './logging/webviewLifecycleLog';
import {
  migrateSecretsFromCursorQuota,
  migrateSettingsFromCursorQuota,
} from './migrations/cursorQuotaMigration';
import { closeAllConnections } from './persistence/agentTrackingRepositoryFactory';
import {
  createExtensionRuntime,
  type ExtensionActivationDependencies,
  type ExtensionRuntime,
} from './composition/createExtensionRuntime';
import { initializeExtensionRuntime } from './composition/extensionInitialization';
import { registerExtensionCommands } from './composition/extensionCommands';
import { startExtensionServices } from './composition/extensionServices';
import { wireExtensionRuntime } from './composition/extensionRuntimeWiring';

export type { ExtensionActivationDependencies } from './composition/createExtensionRuntime';

let refreshService: ExtensionRuntime['refreshService'] | undefined;
let multiProfileQuotaService: ExtensionRuntime['multiProfileQuotaService'] | undefined;
let efficiencyService: ExtensionRuntime['efficiencyService'] | undefined;
let instanceDetectorRef: ExtensionRuntime['instanceDetector'] | undefined;
let proxyManagerRef: ExtensionRuntime['proxyManager'] | undefined;
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
  multiProfileQuotaService = runtime.multiProfileQuotaService;
  efficiencyService = runtime.efficiencyService;
  refreshService = runtime.refreshService;
  instanceDetectorRef = runtime.instanceDetector;
  proxyManagerRef = runtime.proxyManager;

  wireExtensionRuntime(context, runtime, isCurrentActivation);

  lifecycleLog.lifecycle('activate.begin', {
    uiKind: vscode.env.uiKind,
    panelOpen: runtime.accountsPanel.hasResolvedView(),
    timestamp: activateTimestamp,
  });

  activationInitialization = initializeExtensionRuntime(
    runtime,
    isCurrentActivation
  ).catch((err: unknown) => {
    extensionLog.error(
      `[Extension] ProfileManager initialization failed: ${extensionLog.formatError(err)}`
    );
  });

  registerExtensionCommands(context, runtime);
  startExtensionServices(context, runtime);
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
