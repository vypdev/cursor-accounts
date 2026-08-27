import type { IProxyCertificate } from '../domain/ports/IProxyCertificate';
import type { ToWebviewMessage } from '../profiles/types';
import { saveCaCertificateAs } from '../proxy/saveCaCertificate';
import { t } from '../l10n';

export interface AccountsPanelProxyCertificateDependencies {
  proxyCertificate: IProxyCertificate;
}

export interface AccountsPanelProxyCertificateCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
  refreshProxyStatus(options?: { checkCertificate?: boolean }): Promise<void>;
}

/** Handles certificate information, installation, removal, and export actions. */
export class AccountsPanelProxyCertificateHandlers {
  constructor(
    private readonly dependencies: AccountsPanelProxyCertificateDependencies,
    private readonly callbacks: AccountsPanelProxyCertificateCallbacks
  ) {}

  async getInstallGuide(): Promise<void> {
    const guide = await this.dependencies.proxyCertificate.getProxyInstallGuide();
    await this.callbacks.postMessage({
      type: 'proxyInstallGuide',
      data: guide,
    });
  }

  async install(): Promise<void> {
    const result = await this.dependencies.proxyCertificate.installCertificate();
    const installed =
      await this.dependencies.proxyCertificate.checkCertificateInstalled();
    const success = result.success || installed;
    await this.callbacks.postMessage({
      type: 'certificateInstallResult',
      success,
      error: success ? undefined : result.error,
    });
    await this.callbacks.refreshProxyStatus({ checkCertificate: true });
  }

  async uninstall(): Promise<void> {
    const result =
      await this.dependencies.proxyCertificate.uninstallCertificate();
    const installed =
      await this.dependencies.proxyCertificate.checkCertificateInstalled();
    const success = result.success && !installed;
    await this.callbacks.postMessage({
      type: 'certificateUninstallResult',
      success,
      error: success ? undefined : result.error,
    });
    await this.callbacks.refreshProxyStatus({ checkCertificate: true });
  }

  async save(): Promise<void> {
    const result = await saveCaCertificateAs(this.dependencies.proxyCertificate);
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
