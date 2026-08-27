import type { ProxyInstallGuide } from '@cursor-accounts/types';
import type { ProxyCertificateOperationResult } from './IProxyCertificateOperations';

/** Certificate lifecycle and installation information exposed to the UI. */
export interface IProxyCertificate {
  getCertificatePath(): Promise<string | null>;
  getProxyInstallGuide(): Promise<ProxyInstallGuide>;
  installCertificate(): Promise<ProxyCertificateOperationResult>;
  uninstallCertificate(): Promise<ProxyCertificateOperationResult>;
  checkCertificateInstalled(): Promise<boolean>;
  getCachedCertificateInstalled(): boolean | undefined;
}
