import * as fs from 'fs/promises';
import * as path from 'path';
import * as forge from 'node-forge';
import { CA_COMMON_NAME } from './certificateConstants';

export { CA_COMMON_NAME } from './certificateConstants';

export const CA_CERT_FILE = 'ca-cert.pem';
export const CA_KEY_FILE = 'ca-key.pem';
export const CA_PUBLIC_KEY_FILE = 'ca-public.key';

const CA_VALIDITY_YEARS = 10;

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
    await fs.mkdir(this.storageDir, { recursive: true });

    const { certificatePath: certPath, keyPath, publicKeyPath } = this.getPaths();

    try {
      const [certPem, keyPem] = await Promise.all([
        fs.readFile(certPath, 'utf8'),
        fs.readFile(keyPath, 'utf8'),
      ]);
      try {
        await fs.access(publicKeyPath);
      } catch (error) {
        if (!isMissingFile(error)) {
          throw error;
        }
        const cert = forge.pki.certificateFromPem(certPem);
        await fs.writeFile(
          publicKeyPath,
          forge.pki.publicKeyToPem(cert.publicKey),
          { mode: 0o600 }
        );
      }
      void keyPem;
      return certPath;
    } catch {
      // generate below
    }

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(
      cert.validity.notBefore.getFullYear() + CA_VALIDITY_YEARS
    );

    const attrs = [
      { name: 'commonName', value: CA_COMMON_NAME },
      { name: 'organizationName', value: 'Cursor Accounts' },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, digitalSignature: true },
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());

    const certPem = forge.pki.certificateToPem(cert);
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
    const publicKeyPem = forge.pki.publicKeyToPem(keys.publicKey);

    await fs.writeFile(certPath, certPem, { mode: 0o600 });
    await fs.writeFile(keyPath, keyPem, { mode: 0o600 });
    await fs.writeFile(publicKeyPath, publicKeyPem, { mode: 0o600 });

    return certPath;
  }

}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
