import * as vscode from 'vscode';
import { isProfileProxyEnabled } from '@cursor-accounts/types';
import type { ProfileDetector } from '../profiles/profileDetector';
import type { ToWebviewMessage } from '../profiles/types';
import type { IProxyCertificate } from '../domain/ports/IProxyCertificate';
import type { IProxyLifecycle } from '../domain/ports/IProxyLifecycle';
import type { IProxyOutput } from '../domain/ports/IProxyOutput';
import { saveCaCertificateAs } from '../proxy/saveCaCertificate';
import { t } from '../l10n';

export interface AccountsPanelProxyHandlerDependencies {
  profileDetector: ProfileDetector;
  proxyManager: IProxyLifecycle & IProxyCertificate & IProxyOutput;
}

export interface AccountsPanelProxyHandlerCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
  refreshProxyStatus(options?: { checkCertificate?: boolean }): Promise<void>;
}

/** Handles proxy-specific webview actions behind capability-oriented ports. */
export class AccountsPanelProxyHandlers {
  constructor(
    private readonly dependencies: AccountsPanelProxyHandlerDependencies,
    private readonly callbacks: AccountsPanelProxyHandlerCallbacks
  ) {}

  async start(): Promise<void> {
    const currentProfile = await this.dependencies.profileDetector.detectCurrentProfile();
    if (!currentProfile || !isProfileProxyEnabled(currentProfile)) {
      await this.callbacks.postMessage({
        type: 'error',
        message: t('commands.proxy.requiresProfile'),
      });
      return;
    }

    const result = await this.dependencies.proxyManager.start(currentProfile.id);
    if (result.success) {
      await this.callbacks.postMessage({
        type: 'success',
        message: t('commands.proxy.started', {
          port: String(result.port ?? ''),
        }),
      });
    } else {
      await this.callbacks.postMessage({
        type: 'error',
        message: t('commands.proxy.startFailed', {
          error: result.error ?? t('errors.unknown'),
        }),
      });
    }
    await this.callbacks.refreshProxyStatus({ checkCertificate: true });
  }

  async stop(): Promise<void> {
    const currentProfile = await this.dependencies.profileDetector.detectCurrentProfile();
    if (!currentProfile || !isProfileProxyEnabled(currentProfile)) {
      await this.callbacks.postMessage({
        type: 'error',
        message: t('commands.proxy.requiresProfile'),
      });
      return;
    }

    await this.dependencies.proxyManager.stop(currentProfile.id);
    await this.callbacks.postMessage({
      type: 'success',
      message: t('commands.proxy.stopped'),
    });
    await this.callbacks.refreshProxyStatus();
  }

  async showLogs(): Promise<void> {
    await vscode.commands.executeCommand(
      'revealFileInOS',
      vscode.Uri.file(this.dependencies.proxyManager.getLogDirectory())
    );
  }

  async showTraffic(): Promise<void> {
    await vscode.commands.executeCommand('cursorAccounts.proxy.showOutput');
  }

  async getInstallGuide(): Promise<void> {
    const guide = await this.dependencies.proxyManager.getProxyInstallGuide();
    await this.callbacks.postMessage({
      type: 'proxyInstallGuide',
      data: guide,
    });
  }

  async installCertificate(): Promise<void> {
    const result = await this.dependencies.proxyManager.installCertificate();
    const installed = await this.dependencies.proxyManager.checkCertificateInstalled();
    const success = result.success || installed;
    await this.callbacks.postMessage({
      type: 'certificateInstallResult',
      success,
      error: success ? undefined : result.error,
    });
    await this.callbacks.refreshProxyStatus({ checkCertificate: true });
  }

  async uninstallCertificate(): Promise<void> {
    const result = await this.dependencies.proxyManager.uninstallCertificate();
    const installed = await this.dependencies.proxyManager.checkCertificateInstalled();
    const success = result.success && !installed;
    await this.callbacks.postMessage({
      type: 'certificateUninstallResult',
      success,
      error: success ? undefined : result.error,
    });
    await this.callbacks.refreshProxyStatus({ checkCertificate: true });
  }

  async saveCertificate(): Promise<void> {
    const result = await saveCaCertificateAs(this.dependencies.proxyManager);
    if (result.cancelled) {
      return;
    }

    if (result.saved && result.path) {
      await this.callbacks.postMessage({
        type: 'success',
        message: t('commands.proxy.saveCertificate.saved', {
          path: result.path,
        }),
      });
      return;
    }

    await this.callbacks.postMessage({
      type: 'error',
      message: t('commands.proxy.saveCertificate.failed', {
        error: result.error ?? t('commands.proxy.saveCertificate.notFound'),
      }),
    });
  }
}
