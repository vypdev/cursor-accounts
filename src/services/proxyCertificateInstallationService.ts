import type { IProxyCertificateInstaller } from '../domain/ports/IProxyCertificateInstaller';
import type { IProxyCertificateMaterial } from '../domain/ports/IProxyCertificateMaterial';
import type {
  IProxyCertificateOperations,
  ProxyCertificateOperationResult,
} from '../domain/ports/IProxyCertificateOperations';
import type { IProxyCertificateStatus } from '../domain/ports/IProxyCertificateStatus';
import { formatProxyCertificateError } from './proxyCertificateError';

/** Owns trust-store installation and recovery after ambiguous native results. */
export class ProxyCertificateInstallationService
  implements IProxyCertificateInstaller
{
  constructor(
    private readonly certificateOperations: IProxyCertificateOperations,
    private readonly certificateMaterial: IProxyCertificateMaterial,
    private readonly certificateStatus: IProxyCertificateStatus
  ) {}

  async install(): Promise<ProxyCertificateOperationResult> {
    try {
      const certPath = await this.certificateMaterial.getCertificatePath();
      if (!certPath) {
        return {
          success: false,
          error: 'CA certificate is not available. Start the proxy once to generate it.',
        };
      }
      const alreadyInstalled = await this.certificateStatus.checkInstalled();
      if (alreadyInstalled) {
        return { success: true };
      }
      const result = await this.certificateOperations.install();
      if (result.success) {
        this.certificateStatus.setCachedInstalled(true);
        return { success: true };
      }
      const verified = await this.certificateStatus.checkInstalled();
      return verified ? { success: true } : result;
    } catch (error) {
      return { success: false, error: formatProxyCertificateError(error) };
    }
  }

  async uninstall(): Promise<ProxyCertificateOperationResult> {
    try {
      const result = await this.certificateOperations.uninstall();
      if (result.success) {
        this.certificateStatus.setCachedInstalled(false);
        return result;
      }
      const stillInstalled = await this.certificateStatus.checkInstalled();
      return stillInstalled ? result : { success: true };
    } catch (error) {
      return { success: false, error: formatProxyCertificateError(error) };
    }
  }
}
