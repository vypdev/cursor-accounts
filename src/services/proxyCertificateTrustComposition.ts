import type { IProxyCertificateInstaller } from '../domain/ports/IProxyCertificateInstaller';
import type { IProxyCertificateStatus } from '../domain/ports/IProxyCertificateStatus';
import type { IProxyCertificateTrust } from '../domain/ports/IProxyCertificateTrust';

/** Compose trust-store status and lifecycle capabilities for the public port. */
export function createProxyCertificateTrust(
  certificateStatus: IProxyCertificateStatus,
  certificateInstaller: IProxyCertificateInstaller
): IProxyCertificateTrust {
  return {
    checkInstalled: () => certificateStatus.checkInstalled(),
    getCachedInstalled: () => certificateStatus.getCachedInstalled(),
    install: () => certificateInstaller.install(),
    uninstall: () => certificateInstaller.uninstall(),
  };
}
