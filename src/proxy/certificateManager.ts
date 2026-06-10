import * as fs from 'fs/promises';
import * as path from 'path';
import * as forge from 'node-forge';
import { DEFAULT_ALPN_PROTOCOLS } from '../domain/types/httpProtocol';

export const CA_CERT_FILE = 'ca-cert.pem';
export const CA_KEY_FILE = 'ca-key.pem';

export const CA_COMMON_NAME = 'Cursor Accounts MITM Proxy CA';
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
   * ALPN identifiers negotiated on MITM TLS (HTTP/2 + HTTP/1.x).
   * Applied by {@link applyHttpolyglotHttpsPatch} on each HTTPS server.
   */
  getAlpnProtocols(): readonly string[] {
    return DEFAULT_ALPN_PROTOCOLS;
  }

  /**
   * Prepare sslCaDir layout expected by http-mitm-proxy.
   *
   * The library resolves CA material under `{sslCaDir}/certs/ca.pem` and
   * `{sslCaDir}/keys/ca.private.key`. If `certs/ca.pem` is missing it generates
   * its own "NodeMITMProxyCA", which will not match the CA installed from the
   * Accounts panel ("Cursor Accounts MITM Proxy CA").
   */
  async ensureCaDirectoryForMitm(): Promise<string> {
    await this.ensureCaCertificate();
    const mitmCertsDir = path.join(this.storageDir, 'certs');
    const keysDir = path.join(this.storageDir, 'keys');
    await fs.mkdir(mitmCertsDir, { recursive: true });
    await fs.mkdir(keysDir, { recursive: true });

    const mitmCaPath = path.join(mitmCertsDir, 'ca.pem');
    const mitmKeyPath = path.join(keysDir, 'ca.private.key');
    const mitmPublicKeyPath = path.join(keysDir, 'ca.public.key');

    const certPem = await fs.readFile(this.getCertificatePath(), 'utf8');
    const keyPem = await fs.readFile(this.getKeyPath(), 'utf8');
    const publicKeyPem = forge.pki.publicKeyToPem(
      forge.pki.certificateFromPem(certPem).publicKey
    );

    const replaceHostCerts = await this.shouldReplaceMitmCa(mitmCaPath, certPem);

    await fs.writeFile(mitmCaPath, certPem, { mode: 0o600 });
    await fs.writeFile(mitmKeyPath, keyPem, { mode: 0o600 });
    await fs.writeFile(mitmPublicKeyPath, publicKeyPem, { mode: 0o600 });

    // Legacy mistaken path from an earlier layout.
    await fs.rm(path.join(this.storageDir, 'ca.pem'), { force: true });

    if (replaceHostCerts) {
      await this.clearMitmHostCertificates(mitmCertsDir);
    }

    return this.storageDir;
  }

  /** True when the on-disk MITM CA differs from our managed CA (e.g. NodeMITMProxyCA). */
  private async shouldReplaceMitmCa(
    mitmCaPath: string,
    expectedCertPem: string
  ): Promise<boolean> {
    try {
      const existing = await fs.readFile(mitmCaPath, 'utf8');
      if (existing.trim() === expectedCertPem.trim()) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Remove cached per-host leaf certs so http-mitm-proxy re-issues under the new CA. */
  private async clearMitmHostCertificates(mitmCertsDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(mitmCertsDir);
    } catch {
      return;
    }

    await Promise.all(
      entries
        .filter((name) => name.endsWith('.pem') && name !== 'ca.pem')
        .map((name) => fs.rm(path.join(mitmCertsDir, name), { force: true }))
    );
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

  /**
   * Install the CA into the system trust store using native OS elevation prompts.
   */
  async installCertificateWithElevation(): Promise<{
    success: boolean;
    error?: string;
  }> {
    const certPath = await this.ensureCaCertificate();
    const { installCaCertificateElevated } = await import('./installCaCertificate');
    return installCaCertificateElevated(certPath);
  }

  /**
   * Remove the CA from the system trust store using native OS elevation prompts.
   */
  async uninstallCertificate(): Promise<{
    success: boolean;
    error?: string;
  }> {
    const { uninstallCaCertificate } = await import('./installCaCertificate');
    return uninstallCaCertificate();
  }
}
