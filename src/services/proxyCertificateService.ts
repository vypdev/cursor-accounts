import type { IProxyCertificateMaterial } from '../domain/ports/IProxyCertificateMaterial';
import type { IProxyCertificateService } from '../domain/ports/IProxyCertificateService';
import type { IProxyCertificateTrust } from '../domain/ports/IProxyCertificateTrust';

export { formatProxyCertificateError } from './proxyCertificateTrustService';

/** Compatibility facade combining material and trust-store certificate capabilities. */
export class ProxyCertificateService implements IProxyCertificateService {
  constructor(
    private readonly certificateMaterial: IProxyCertificateMaterial,
    private readonly certificateTrust: IProxyCertificateTrust
  ) {}

  ensureCaCertificate(): Promise<string> {
    return this.certificateMaterial.ensureCaCertificate();
  }

  getCertificatePath(): Promise<string | null> {
    return this.certificateMaterial.getCertificatePath();
  }

  checkInstalled(): Promise<boolean> {
    return this.certificateTrust.checkInstalled();
  }

  getCachedInstalled(): boolean | undefined {
    return this.certificateTrust.getCachedInstalled();
  }

  install() {
    return this.certificateTrust.install();
  }

  uninstall() {
    return this.certificateTrust.uninstall();
  }

  getInstallGuide() {
    return this.certificateMaterial.getInstallGuide();
  }
}
