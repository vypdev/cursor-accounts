import * as fs from 'fs/promises';
import type { ProxyInstallGuide } from '@cursor-accounts/types';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IProxyCertificateService } from '../domain/ports/IProxyCertificateService';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import { buildProxyInstallGuide } from '../proxy/buildProxyInstallGuide';
import { CertificateManager } from '../proxy/certificateManager';
import { verifyCaCertificateInstalled } from '../proxy/installCaCertificate';

export class ProxyCertificateService implements IProxyCertificateService {
  private cachedInstalled: boolean | undefined;

  constructor(
    private readonly certManager: CertificateManager,
    private readonly stateStore: IProxyStateStore,
    private readonly profileManager: IProfileManager
  ) {}

  async ensureCaCertificate(): Promise<string> {
    return this.certManager.ensureCaCertificate();
  }

  async getCertificatePath(): Promise<string | null> {
    const profiles = await this.profileManager.getProfiles();
    for (const profile of profiles) {
      const state = await this.stateStore.read(profile.userDataDir);
      if (state?.caCertificatePath) {
        try {
          await fs.access(state.caCertificatePath);
          return state.caCertificatePath;
        } catch {
          // fall through
        }
      }
    }

    try {
      return await this.certManager.ensureCaCertificate();
    } catch {
      return null;
    }
  }

  async checkInstalled(): Promise<boolean> {
    const installed = await verifyCaCertificateInstalled();
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
      const result = await this.certManager.installCertificateWithElevation();
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
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  async uninstall(): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.certManager.uninstallCertificate();
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
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  async getInstallGuide(): Promise<ProxyInstallGuide> {
    const certPath = await this.getCertificatePath();
    return buildProxyInstallGuide({ certPath });
  }
}
