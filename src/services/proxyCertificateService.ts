import type { ProxyInstallGuide } from '@cursor-accounts/types';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type { IProxyCertificateOperations } from '../domain/ports/IProxyCertificateOperations';
import type { IProxyCertificateService } from '../domain/ports/IProxyCertificateService';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import { buildProxyInstallGuide } from '../proxy/buildProxyInstallGuide';

export function formatProxyCertificateError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ProxyCertificateService implements IProxyCertificateService {
  private cachedInstalled: boolean | undefined;

  constructor(
    private readonly certificateOperations: IProxyCertificateOperations,
    private readonly stateStore: IProxyStateStore,
    private readonly profileManager: IProfileReader
  ) {}

  async ensureCaCertificate(): Promise<string> {
    return this.certificateOperations.ensureCaCertificate();
  }

  async getCertificatePath(): Promise<string | null> {
    const profiles = await this.profileManager.getProfiles();
    for (const profile of profiles) {
      const state = await this.stateStore.read(profile.userDataDir);
      if (state?.caCertificatePath) {
        try {
          if (
            await this.certificateOperations.certificatePathExists(
              state.caCertificatePath
            )
          ) {
            return state.caCertificatePath;
          }
        } catch {
          // fall through
        }
      }
    }

    try {
      return await this.certificateOperations.ensureCaCertificate();
    } catch {
      return null;
    }
  }

  async checkInstalled(): Promise<boolean> {
    const installed = await this.certificateOperations.checkInstalled();
    this.cachedInstalled = installed;
    return installed;
  }

  getCachedInstalled(): boolean | undefined {
    return this.cachedInstalled;
  }

  async install(): Promise<{ success: boolean; error?: string }> {
    try {
      const certPath = await this.getCertificatePath();
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

  async uninstall(): Promise<{ success: boolean; error?: string }> {
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

  async getInstallGuide(): Promise<ProxyInstallGuide> {
    const certPath = await this.getCertificatePath();
    return buildProxyInstallGuide({ certPath });
  }
}
