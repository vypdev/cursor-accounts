import * as fs from 'fs/promises';
import type { IProxyCertificateOperations } from '../domain/ports/IProxyCertificateOperations';
import { verifyCaCertificateInstalled } from './installCaCertificate';

interface CertificateManagerOperations {
  ensureCaCertificate(): Promise<string>;
  installCertificateWithElevation(): Promise<{ success: boolean; error?: string }>;
  uninstallCertificate(): Promise<{ success: boolean; error?: string }>;
}

export interface ProxyCertificateOperationAdapterDependencies {
  access: (certificatePath: string) => Promise<void>;
  checkInstalled: () => Promise<boolean>;
}

/** Adapts certificate-manager and host trust-store operations to the domain port. */
export function createProxyCertificateOperations(
  certificateManager: CertificateManagerOperations,
  dependencies: ProxyCertificateOperationAdapterDependencies = {
    access: fs.access,
    checkInstalled: verifyCaCertificateInstalled,
  }
): IProxyCertificateOperations {
  return {
    ensureCaCertificate: () => certificateManager.ensureCaCertificate(),
    certificatePathExists: async (certificatePath) => {
      try {
        await dependencies.access(certificatePath);
        return true;
      } catch {
        return false;
      }
    },
    checkInstalled: () => dependencies.checkInstalled(),
    install: () => certificateManager.installCertificateWithElevation(),
    uninstall: () => certificateManager.uninstallCertificate(),
  };
}
