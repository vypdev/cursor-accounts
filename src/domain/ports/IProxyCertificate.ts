import type { ProxyInstallGuide } from '@cursor-accounts/types';

/** Certificate lifecycle and installation information exposed to the UI. */
export interface IProxyCertificate {
  getCertificatePath(): Promise<string | null>;
  getProxyInstallGuide(): Promise<ProxyInstallGuide>;
  installCertificate(): Promise<{ success: boolean; error?: string }>;
  uninstallCertificate(): Promise<{ success: boolean; error?: string }>;
  checkCertificateInstalled(): Promise<boolean>;
  getCachedCertificateInstalled(): boolean | undefined;
}
