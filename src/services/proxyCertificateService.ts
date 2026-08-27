import type { IProxyCertificateMaterial } from '../domain/ports/IProxyCertificateMaterial';
import type { IProxyCertificateService } from '../domain/ports/IProxyCertificateService';
import type { IProxyCertificateTrust } from '../domain/ports/IProxyCertificateTrust';

export { formatProxyCertificateError } from './proxyCertificateTrustService';

/** Compose the certificate capabilities required by existing proxy boundaries. */
export function createProxyCertificateService(
  certificateMaterial: IProxyCertificateMaterial,
  certificateTrust: IProxyCertificateTrust
): IProxyCertificateService {
  return {
    ensureCaCertificate: () => certificateMaterial.ensureCaCertificate(),
    getCertificatePath: () => certificateMaterial.getCertificatePath(),
    getInstallGuide: () => certificateMaterial.getInstallGuide(),
    checkInstalled: () => certificateTrust.checkInstalled(),
    getCachedInstalled: () => certificateTrust.getCachedInstalled(),
    install: () => certificateTrust.install(),
    uninstall: () => certificateTrust.uninstall(),
  };
}
