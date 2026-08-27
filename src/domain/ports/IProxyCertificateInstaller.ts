import type { ProxyCertificateOperationResult } from './IProxyCertificateOperations';

/** Installs or removes the managed CA certificate from the trust store. */
export interface IProxyCertificateInstaller {
  install(): Promise<ProxyCertificateOperationResult>;
  uninstall(): Promise<ProxyCertificateOperationResult>;
}
