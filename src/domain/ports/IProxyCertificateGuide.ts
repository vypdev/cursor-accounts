import type { ProxyInstallGuide } from '@cursor-accounts/types';

/** Builds the user-facing guide for trusting the managed CA certificate. */
export interface IProxyCertificateGuide {
  getInstallGuide(): Promise<ProxyInstallGuide>;
}
