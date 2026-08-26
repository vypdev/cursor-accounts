import * as vscode from 'vscode';
import * as extensionLog from '../logging/extensionLog';
import type { ExtensionRuntime } from './createExtensionRuntime';

/** Starts configured periodic services and binds their disposal to activation. */
export function startExtensionServices(
  context: vscode.ExtensionContext,
  runtime: ExtensionRuntime
): void {
  const profilesConfig = vscode.workspace.getConfiguration(
    'cursorAccounts.profiles'
  );
  const refreshAllInterval = profilesConfig.get<number>(
    'refreshAllInterval',
    300
  );
  runtime.multiProfileQuotaService.start(refreshAllInterval);
  extensionLog.info(
    `[Extension] MultiProfileQuotaService started (interval ${refreshAllInterval}s)`
  );

  if (profilesConfig.get<boolean>('autoDetectRunning', true)) {
    const detectionIntervalSeconds = profilesConfig.get<number>(
      'instanceDetectionInterval',
      30
    );
    runtime.instanceDetector.startAutoDetection(detectionIntervalSeconds * 1000);
    extensionLog.info(
      `[Extension] InstanceDetector auto-detection started (interval ${detectionIntervalSeconds}s)`
    );
  } else {
    extensionLog.debug(
      '[Extension] InstanceDetector auto-detection disabled by configuration'
    );
  }

  context.subscriptions.push(
    {
      dispose: () => runtime.multiProfileQuotaService.stop(),
    },
    {
      dispose: () => runtime.instanceDetector.stopAutoDetection(),
    },
    {
      dispose: () => runtime.efficiencyService.dispose(),
    },
    {
      dispose: () => {
        runtime.proxyOutputPresenter.dispose();
        runtime.tokenDetectorPresenter.dispose();
      },
    }
  );

  runtime.statusBar.showOnActivate();
  runtime.refreshService.start();
}
