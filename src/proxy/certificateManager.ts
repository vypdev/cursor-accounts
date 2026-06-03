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

  /**
   * Platform-specific instructions for trusting the generated CA.
   */
  getInstallationInstructions(certPath: string): string {
    const quoted = JSON.stringify(certPath);

    switch (process.platform) {
      case 'darwin':
        return [
          'Install the MITM proxy CA on macOS:',
          '',
          `1. Open Keychain Access`,
          `2. File → Import Items… → select ${quoted}`,
          '3. Double-click the imported certificate',
          '4. Expand Trust → set "When using this certificate" to Always Trust',
          '5. Close the dialog and enter your password',
          '',
          'Alternatively in Terminal:',
          `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ${quoted}`,
        ].join('\n');

      case 'win32':
        return [
          'Install the MITM proxy CA on Windows:',
          '',
          `1. Double-click ${quoted}`,
          '2. Install Certificate → Local Machine → Place in "Trusted Root Certification Authorities"',
          '3. Finish the wizard',
          '',
          'Or run as Administrator in PowerShell:',
          `Import-Certificate -FilePath ${quoted} -CertStoreLocation Cert:\\LocalMachine\\Root`,
        ].join('\n');

      default:
        return [
          'Install the MITM proxy CA on Linux:',
          '',
          `sudo cp ${quoted} /usr/local/share/ca-certificates/cursor-accounts-mitm.crt`,
          'sudo update-ca-certificates',
          '',
          'For Chromium/Electron only (no system trust):',
          `export NODE_EXTRA_CA_CERTS=${quoted}`,
        ].join('\n');
    }
  }
}
