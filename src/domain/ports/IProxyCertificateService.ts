import type { ProxyInstallGuide } from '@cursor-accounts/types';

export interface IProxyCertificateService {
  ensureCaCertificate(): Promise<string>;
  getCertificatePath(): Promise<string | null>;
  checkInstalled(): Promise<boolean>;
  getCachedInstalled(): boolean | undefined;
  install(): Promise<{ success: boolean; error?: string }>;
  uninstall(): Promise<{ success: boolean; error?: string }>;
  getInstallGuide(): Promise<ProxyInstallGuide>;
}
