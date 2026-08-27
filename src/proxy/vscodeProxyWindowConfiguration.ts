import type { IProxyWindowConfiguration } from '../domain/ports/IProxyWindowConfiguration';
import {
  clearProxyVscodeConfiguration,
  syncProxyVscodeConfiguration,
} from './syncProxyVscodeConfiguration';

/** VS Code adapter for the active window's temporary proxy configuration. */
export class VscodeProxyWindowConfiguration
  implements IProxyWindowConfiguration
{
  async syncProxy(proxyUrl: string): Promise<void> {
    await syncProxyVscodeConfiguration(proxyUrl);
  }

  async clearProxy(): Promise<void> {
    await clearProxyVscodeConfiguration();
  }
}
