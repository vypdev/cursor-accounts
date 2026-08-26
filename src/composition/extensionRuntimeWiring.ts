import type * as vscode from 'vscode';
import * as extensionLog from '../logging/extensionLog';
import type { ExtensionRuntime } from './createExtensionRuntime';
import type { ActivationGuard } from './extensionInitialization';

/** Connects runtime event sources to their presentation and persistence sinks. */
export function wireExtensionRuntime(
  context: vscode.ExtensionContext,
  runtime: ExtensionRuntime,
  isCurrentActivation: ActivationGuard
): void {
  const {
    efficiencyStatsStorage,
    accountsPanel,
    activeConversationStatusBar,
    activeConversationTracker,
    proxyManager,
    agentLiveUsageStatusBar,
  } = runtime;

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
}
