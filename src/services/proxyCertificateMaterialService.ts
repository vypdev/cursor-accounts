import type { ProxyInstallGuide } from '@cursor-accounts/types';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { IProxyCertificateMaterial } from '../domain/ports/IProxyCertificateMaterial';
import type { IProxyCertificateOperations } from '../domain/ports/IProxyCertificateOperations';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import { buildProxyInstallGuide } from '../proxy/buildProxyInstallGuide';

/** Resolves managed CA material without knowing how it is stored or generated. */
export class ProxyCertificateMaterialService implements IProxyCertificateMaterial {
  constructor(
    private readonly certificateOperations: IProxyCertificateOperations,
    private readonly stateStore: IProxyStateStore,
    private readonly profileManager: IProfileReader
  ) {}

  async ensureCaCertificate(): Promise<string> {
    return this.certificateOperations.ensureCaCertificate();
  }

  async getCertificatePath(): Promise<string | null> {
    const persistedPath = await this.findPersistedCertificatePath();
    if (persistedPath) {
      return persistedPath;
    }

    try {
      return await this.certificateOperations.ensureCaCertificate();
    } catch {
      return null;
    }
  }

  async getInstallGuide(): Promise<ProxyInstallGuide> {
    const certPath = await this.getCertificatePath();
    return buildProxyInstallGuide({ certPath });
  }

  private async findPersistedCertificatePath(): Promise<string | null> {
    const profiles = await this.profileManager.getProfiles();
    for (const profile of profiles) {
      const state = await this.stateStore.read(profile.userDataDir);
      const certificatePath = state?.caCertificatePath;
      if (certificatePath && (await this.isAvailable(certificatePath))) {
        return certificatePath;
      }
    }
    return null;
  }

  private async isAvailable(certificatePath: string): Promise<boolean> {
    try {
      return await this.certificateOperations.certificatePathExists(
        certificatePath
      );
    } catch {
      return false;
    }
  }
}
