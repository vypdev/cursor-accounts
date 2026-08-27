import * as fs from 'fs/promises';
import type { IProxyCertificateOperations } from '../domain/ports/IProxyCertificateOperations';
import {
  installCaCertificateElevated,
  uninstallCaCertificate,
  verifyCaCertificateInstalled,
} from './installCaCertificate';

interface CertificateMaterialOperations {
  ensureCaCertificate(): Promise<string>;
}

export interface ProxyCertificateOperationAdapterDependencies {
  access?: (certificatePath: string) => Promise<void>;
  checkInstalled?: () => Promise<boolean>;
  install?: (certificatePath: string) => Promise<{ success: boolean; error?: string }>;
  uninstall?: () => Promise<{ success: boolean; error?: string }>;
}

/** Adapts certificate material and host trust-store operations to the domain port. */
export function createProxyCertificateOperations(
  certificateManager: CertificateMaterialOperations,
  dependencies: ProxyCertificateOperationAdapterDependencies = {}
): IProxyCertificateOperations {
  const access = dependencies.access ?? fs.access;
  const checkInstalled =
    dependencies.checkInstalled ?? verifyCaCertificateInstalled;
  const install = dependencies.install ?? installCaCertificateElevated;
  const uninstall = dependencies.uninstall ?? uninstallCaCertificate;

  return {
    ensureCaCertificate: () => certificateManager.ensureCaCertificate(),
    certificatePathExists: async (certificatePath) => {
      try {
        await access(certificatePath);
        return true;
      } catch {
        return false;
      }
    },
    checkInstalled: () => checkInstalled(),
    install: async () => install(await certificateManager.ensureCaCertificate()),
    uninstall: () => uninstall(),
  };
}
