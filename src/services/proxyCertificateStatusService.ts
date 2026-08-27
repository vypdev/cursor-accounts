import type { IProxyCertificateOperations } from '../domain/ports/IProxyCertificateOperations';
import type { IProxyCertificateStatus } from '../domain/ports/IProxyCertificateStatus';

/** Owns trust-store verification and its in-memory status cache. */
export class ProxyCertificateStatusService implements IProxyCertificateStatus {
  private cachedInstalled: boolean | undefined;

  constructor(
    private readonly certificateOperations: IProxyCertificateOperations
  ) {}

  async checkInstalled(): Promise<boolean> {
    const installed = await this.certificateOperations.checkInstalled();
    this.cachedInstalled = installed;
    return installed;
  }

  getCachedInstalled(): boolean | undefined {
    return this.cachedInstalled;
  }

  setCachedInstalled(installed: boolean): void {
    this.cachedInstalled = installed;
  }
}
