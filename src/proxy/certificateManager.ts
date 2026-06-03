import * as fs from 'fs/promises';
import * as path from 'path';
import * as forge from 'node-forge';

export const CA_CERT_FILE = 'ca-cert.pem';
export const CA_KEY_FILE = 'ca-key.pem';

const CA_COMMON_NAME = 'Cursor Accounts MITM Proxy CA';
const CA_VALIDITY_YEARS = 10;

/**
 * Generates and stores a self-signed CA for HTTPS MITM.
 * Certificate files live under the given storage directory.
 */
export class CertificateManager {
  constructor(private readonly storageDir: string) {}

  getCertificatePath(): string {
    return path.join(this.storageDir, CA_CERT_FILE);
  }

  getKeyPath(): string {
    return path.join(this.storageDir, CA_KEY_FILE);
  }

  /**
   * Prepare sslCaDir layout expected by http-mitm-proxy (ca.pem + keys/).
   */
  async ensureCaDirectoryForMitm(): Promise<string> {
    await this.ensureCaCertificate();
    const keysDir = path.join(this.storageDir, 'keys');
    await fs.mkdir(keysDir, { recursive: true });

    const mitmCaPath = path.join(this.storageDir, 'ca.pem');
    const mitmKeyPath = path.join(keysDir, 'ca.private.key');

    const certPem = await fs.readFile(this.getCertificatePath(), 'utf8');
    const keyPem = await fs.readFile(this.getKeyPath(), 'utf8');

    await fs.writeFile(mitmCaPath, certPem, { mode: 0o600 });
    await fs.writeFile(mitmKeyPath, keyPem, { mode: 0o600 });

    return this.storageDir;
  }

  /**
   * Ensure CA certificate and private key exist on disk.
   */
  async ensureCaCertificate(): Promise<string> {
    await fs.mkdir(this.storageDir, { recursive: true });

    const certPath = this.getCertificatePath();
    const keyPath = this.getKeyPath();

    try {
      await fs.access(certPath);
      await fs.access(keyPath);
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

    await fs.writeFile(certPath, certPem, { mode: 0o600 });
    await fs.writeFile(keyPath, keyPem, { mode: 0o600 });

    return certPath;
  }

}
