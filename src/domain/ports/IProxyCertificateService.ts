import type { ProxyInstallGuide } from '@cursor-accounts/types';
import type { ProxyCertificateOperationResult } from './IProxyCertificateOperations';

export interface IProxyCertificateService {
  ensureCaCertificate(): Promise<string>;
  getCertificatePath(): Promise<string | null>;
  checkInstalled(): Promise<boolean>;
  getCachedInstalled(): boolean | undefined;
  install(): Promise<ProxyCertificateOperationResult>;
  uninstall(): Promise<ProxyCertificateOperationResult>;
  getInstallGuide(): Promise<ProxyInstallGuide>;
}
