import type { IProxyCertificateGenerator } from '../domain/ports/IProxyCertificateGenerator';
import type { IProxyCertificateMaterial } from '../domain/ports/IProxyCertificateMaterial';
import type { IProxyCertificateService } from '../domain/ports/IProxyCertificateService';
import type { IProxyCertificateTrust } from '../domain/ports/IProxyCertificateTrust';

export { formatProxyCertificateError } from './proxyCertificateError';

/** Compose certificate capabilities required by existing proxy boundaries. */
export function createProxyCertificateService(
  certificateGenerator: IProxyCertificateGenerator,
  certificateMaterial: IProxyCertificateMaterial,
  certificateTrust: IProxyCertificateTrust
): IProxyCertificateService {
  return {
    ensureCaCertificate: () => certificateGenerator.ensureCaCertificate(),
    getCertificatePath: () => certificateMaterial.getCertificatePath(),
    getInstallGuide: () => certificateMaterial.getInstallGuide(),
    ...certificateTrust,
  };
}
