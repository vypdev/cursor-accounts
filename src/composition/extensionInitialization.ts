import { isProfileProxyEnabled } from '@cursor-accounts/types';
import { hasActiveWorkspace } from '../services/activeWorkspaceService';
import { shouldAutoOpenAccountsPanel } from '../ui/accountsPanelStartup';
import * as extensionLog from '../logging/extensionLog';
import * as lifecycleLog from '../logging/webviewLifecycleLog';
import type { ExtensionRuntime } from './createExtensionRuntime';

export type ActivationGuard = () => boolean;

/**
 * Initializes profile-dependent services after activation while preventing a
 * stale activation from mutating the current extension-host runtime.
 */
export async function initializeExtensionRuntime(
  runtime: ExtensionRuntime,
  isCurrentActivation: ActivationGuard
): Promise<void> {
  const {
    profileManager,
    profileDetector,
    proxyManager,
    efficiencyService,
    accountsPanel,
  } = runtime;

  if (!isCurrentActivation()) {
    return;
  }

  await profileManager.initialize();
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

  await efficiencyService.initialize();

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
    // Intentionally disabled: an unassigned window does not imply that no
    // other profile windows are active; restoring would wipe valid settings.
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
}
