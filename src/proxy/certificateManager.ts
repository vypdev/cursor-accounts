import * as fs from 'fs/promises';
import * as path from 'path';
import * as forge from 'node-forge';
import { generateCertificateMaterial } from './certificateMaterialGenerator';

export { CA_COMMON_NAME } from './certificateConstants';

export const CA_CERT_FILE = 'ca-cert.pem';
export const CA_KEY_FILE = 'ca-key.pem';
export const CA_PUBLIC_KEY_FILE = 'ca-public.key';

export interface CertificateMaterialPaths {
  certificatePath: string;
  keyPath: string;
  publicKeyPath: string;
}

/**
 * Generates and stores a self-signed CA for HTTPS MITM.
 * Certificate files live under the given storage directory.
 */
export class CertificateManager {
  private pendingEnsure: Promise<string> | undefined;

  constructor(private readonly storageDir: string) {}

  getPaths(): CertificateMaterialPaths {
    return {
      certificatePath: path.join(this.storageDir, CA_CERT_FILE),
      keyPath: path.join(this.storageDir, CA_KEY_FILE),
      publicKeyPath: path.join(this.storageDir, CA_PUBLIC_KEY_FILE),
    };
  }

  /**
   * Ensure CA certificate and private key exist on disk.
   */
  async ensureCaCertificate(): Promise<string> {
    if (!this.pendingEnsure) {
      const pending = this.ensureCaCertificateInternal();
      this.pendingEnsure = pending;
      void pending.then(
        () => this.clearPendingEnsure(pending),
        () => this.clearPendingEnsure(pending)
      );
    }
    return this.pendingEnsure;
  }

  private async ensureCaCertificateInternal(): Promise<string> {
    await fs.mkdir(this.storageDir, { recursive: true });

    const { certificatePath: certPath, keyPath, publicKeyPath } = this.getPaths();

    if (await readExistingMaterial(certPath, keyPath, publicKeyPath)) {
      return certPath;
    }

    const material = generateCertificateMaterial();

    await fs.writeFile(certPath, material.certificatePem, { mode: 0o600 });
    await fs.writeFile(keyPath, material.keyPem, { mode: 0o600 });
    await fs.writeFile(publicKeyPath, material.publicKeyPem, { mode: 0o600 });

    return certPath;
  }

  private clearPendingEnsure(pending: Promise<string>): void {
    if (this.pendingEnsure === pending) {
      this.pendingEnsure = undefined;
    }
  }

}

async function readExistingMaterial(
  certPath: string,
  keyPath: string,
  publicKeyPath: string
): Promise<boolean> {
  const [certRead, keyRead] = await Promise.allSettled([
    fs.readFile(certPath, 'utf8'),
    fs.readFile(keyPath, 'utf8'),
  ]);
  const unexpectedFailure = [certRead, keyRead].find(
    (result): result is PromiseRejectedResult =>
      result.status === 'rejected' && !isMissingFile(result.reason)
  );
  if (unexpectedFailure) {
    throw unexpectedFailure.reason;
  }
  if (certRead.status === 'rejected' || keyRead.status === 'rejected') {
    return false;
  }

  try {
    await fs.access(publicKeyPath);
    return true;
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }

  let publicKeyPem: string;
  try {
    const cert = forge.pki.certificateFromPem(certRead.value);
    publicKeyPem = forge.pki.publicKeyToPem(cert.publicKey);
  } catch {
    return false;
  }

  await fs.writeFile(publicKeyPath, publicKeyPem, { mode: 0o600 });
  return true;
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
