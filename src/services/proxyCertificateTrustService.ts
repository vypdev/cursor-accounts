import type { IProxyCertificateMaterial } from '../domain/ports/IProxyCertificateMaterial';
import type {
  IProxyCertificateOperations,
  ProxyCertificateOperationResult,
} from '../domain/ports/IProxyCertificateOperations';
import type { IProxyCertificateTrust } from '../domain/ports/IProxyCertificateTrust';

export function formatProxyCertificateError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Owns trust-store verification, installation recovery, and cached status. */
export class ProxyCertificateTrustService implements IProxyCertificateTrust {
  private cachedInstalled: boolean | undefined;

  constructor(
    private readonly certificateOperations: IProxyCertificateOperations,
    private readonly certificateMaterial: IProxyCertificateMaterial
  ) {}

  async checkInstalled(): Promise<boolean> {
    const installed = await this.certificateOperations.checkInstalled();
    this.cachedInstalled = installed;
    return installed;
  }

  getCachedInstalled(): boolean | undefined {
    return this.cachedInstalled;
  }

  async install(): Promise<ProxyCertificateOperationResult> {
    try {
      const certPath = await this.certificateMaterial.getCertificatePath();
      if (!certPath) {
        return {
          success: false,
          error: 'CA certificate is not available. Start the proxy once to generate it.',
        };
      }
      const alreadyInstalled = await this.checkInstalled();
      if (alreadyInstalled) {
        return { success: true };
      }
      const result = await this.certificateOperations.install();
      if (result.success) {
        this.cachedInstalled = true;
      } else {
        const verified = await this.checkInstalled();
        if (verified) {
          return { success: true };
        }
      }
      return result;
    } catch (error) {
      return { success: false, error: formatProxyCertificateError(error) };
    }
  }

  async uninstall(): Promise<ProxyCertificateOperationResult> {
    try {
      const result = await this.certificateOperations.uninstall();
      if (result.success) {
        this.cachedInstalled = false;
      } else {
        const stillInstalled = await this.checkInstalled();
        if (!stillInstalled) {
          return { success: true };
        }
      }
      return result;
    } catch (error) {
      return { success: false, error: formatProxyCertificateError(error) };
    }
  }
}
