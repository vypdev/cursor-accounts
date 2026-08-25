import type { ProxyStatus } from '@cursor-accounts/types';

/** Read-only proxy capabilities required to assemble the Accounts panel model. */
export interface IProxyPanelRead {
  getStatus(profileId: string): Promise<ProxyStatus | null>;
  isCurrentWindowUsingProxy(): Promise<boolean>;
  checkCertificateInstalled(): Promise<boolean>;
  getCachedCertificateInstalled(): boolean | undefined;
  getProxyServerUrl(profileId: string): Promise<string | null>;
}
