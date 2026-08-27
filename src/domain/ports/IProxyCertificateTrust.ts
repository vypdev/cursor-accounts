import type { ProxyCertificateOperationResult } from './IProxyCertificateOperations';

/** Trust-store lifecycle capabilities exposed to the proxy facade. */
export interface IProxyCertificateTrust {
  checkInstalled(): Promise<boolean>;
  getCachedInstalled(): boolean | undefined;
  install(): Promise<ProxyCertificateOperationResult>;
  uninstall(): Promise<ProxyCertificateOperationResult>;
}
