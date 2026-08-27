import type { ProxyInstallGuide } from '@cursor-accounts/types';

/** Certificate material and user-facing installation-guide capabilities. */
export interface IProxyCertificateMaterial {
  ensureCaCertificate(): Promise<string>;
  getCertificatePath(): Promise<string | null>;
  getInstallGuide(): Promise<ProxyInstallGuide>;
}
