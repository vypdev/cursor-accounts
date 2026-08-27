import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { ToWebviewMessage } from '../profiles/types';
import type { IProxyCertificate } from '../domain/ports/IProxyCertificate';
import type { IProxyLifecycle } from '../domain/ports/IProxyLifecycle';
import type { IProxyOutput } from '../domain/ports/IProxyOutput';
import { AccountsPanelProxyCertificateHandlers } from './accountsPanelProxyCertificateHandlers';
import { AccountsPanelProxyOutputHandlers } from './accountsPanelProxyOutputHandlers';
import { AccountsPanelProxyRuntimeHandlers } from './accountsPanelProxyRuntimeHandlers';

export interface AccountsPanelProxyHandlerDependencies {
  profileDetector: IProfileDetector;
  proxyManager: IProxyLifecycle & IProxyCertificate & IProxyOutput;
}

export interface AccountsPanelProxyHandlerCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
  refreshProxyStatus(options?: { checkCertificate?: boolean }): Promise<void>;
}

/** Compatibility facade preserving the original Accounts panel proxy API. */
export class AccountsPanelProxyHandlers {
  private readonly runtimeHandlers: AccountsPanelProxyRuntimeHandlers;
  private readonly certificateHandlers: AccountsPanelProxyCertificateHandlers;
  private readonly outputHandlers: AccountsPanelProxyOutputHandlers;

  constructor(
    dependencies: AccountsPanelProxyHandlerDependencies,
    callbacks: AccountsPanelProxyHandlerCallbacks
  ) {
    this.runtimeHandlers = new AccountsPanelProxyRuntimeHandlers(
      {
        profileDetector: dependencies.profileDetector,
        proxyLifecycle: dependencies.proxyManager,
      },
      callbacks
    );
    this.certificateHandlers = new AccountsPanelProxyCertificateHandlers(
      { proxyCertificate: dependencies.proxyManager },
      callbacks
    );
    this.outputHandlers = new AccountsPanelProxyOutputHandlers({
      proxyOutput: dependencies.proxyManager,
    });
  }

  start(): Promise<void> {
    return this.runtimeHandlers.start();
  }

  stop(): Promise<void> {
    return this.runtimeHandlers.stop();
  }

  showLogs(): Promise<void> {
    return this.outputHandlers.showLogs();
  }

  showTraffic(): Promise<void> {
    return this.outputHandlers.showTraffic();
  }

  getInstallGuide(): Promise<void> {
    return this.certificateHandlers.getInstallGuide();
  }

  installCertificate(): Promise<void> {
    return this.certificateHandlers.install();
  }

  uninstallCertificate(): Promise<void> {
    return this.certificateHandlers.uninstall();
  }

  saveCertificate(): Promise<void> {
    return this.certificateHandlers.save();
  }
}
