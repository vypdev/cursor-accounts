import { isProfileProxyEnabled } from '@cursor-accounts/types';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProxyLifecycle } from '../domain/ports/IProxyLifecycle';
import type { ToWebviewMessage } from '../profiles/types';
import { t } from '../l10n';

export interface AccountsPanelProxyRuntimeDependencies {
  profileDetector: IProfileDetector;
  proxyLifecycle: IProxyLifecycle;
}

export interface AccountsPanelProxyRuntimeCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
  refreshProxyStatus(options?: { checkCertificate?: boolean }): Promise<void>;
}

/** Handles start and stop actions for the proxy attached to the current profile. */
export class AccountsPanelProxyRuntimeHandlers {
  constructor(
    private readonly dependencies: AccountsPanelProxyRuntimeDependencies,
    private readonly callbacks: AccountsPanelProxyRuntimeCallbacks
  ) {}

  async start(): Promise<void> {
    const profile = await this.getEnabledCurrentProfile();
    if (!profile) {
      await this.postProfileRequiredError();
      return;
    }

    const result = await this.dependencies.proxyLifecycle.start(profile.id);
    await this.callbacks.postMessage(
      result.success
        ? {
            type: 'success',
            message: t('commands.proxy.started', {
              port: String(result.port ?? ''),
            }),
          }
        : {
            type: 'error',
            message: t('commands.proxy.startFailed', {
              error: result.error ?? t('errors.unknown'),
            }),
          }
    );
    await this.callbacks.refreshProxyStatus({ checkCertificate: true });
  }

  async stop(): Promise<void> {
    const profile = await this.getEnabledCurrentProfile();
    if (!profile) {
      await this.postProfileRequiredError();
      return;
    }

    await this.dependencies.proxyLifecycle.stop(profile.id);
    await this.callbacks.postMessage({
      type: 'success',
      message: t('commands.proxy.stopped'),
    });
    await this.callbacks.refreshProxyStatus();
  }

  private async getEnabledCurrentProfile() {
    const profile = await this.dependencies.profileDetector.detectCurrentProfile();
    return profile && isProfileProxyEnabled(profile) ? profile : null;
  }

  private async postProfileRequiredError(): Promise<void> {
    await this.callbacks.postMessage({
      type: 'error',
      message: t('commands.proxy.requiresProfile'),
    });
  }
}
