import * as fs from 'fs/promises';
import * as path from 'path';
import type { IMitmCertificateDirectory } from '../domain/ports/IMitmCertificateDirectory';

interface CertificateMaterial {
  ensureCaCertificate(): Promise<string>;
  getPaths(): {
    certificatePath: string;
    keyPath: string;
    publicKeyPath: string;
  };
}

/** Adapts managed CA material to the sslCaDir layout required by http-mitm-proxy. */
export class MitmCertificateDirectory implements IMitmCertificateDirectory {
  constructor(
    private readonly storageDir: string,
    private readonly certificateMaterial: CertificateMaterial
  ) {}

  async ensureCaDirectoryForMitm(): Promise<string> {
    await this.certificateMaterial.ensureCaCertificate();
    const mitmCertsDir = path.join(this.storageDir, 'certs');
    const keysDir = path.join(this.storageDir, 'keys');
    await fs.mkdir(mitmCertsDir, { recursive: true });
    await fs.mkdir(keysDir, { recursive: true });

    const mitmCaPath = path.join(mitmCertsDir, 'ca.pem');
    const mitmKeyPath = path.join(keysDir, 'ca.private.key');
    const mitmPublicKeyPath = path.join(keysDir, 'ca.public.key');

    const { certificatePath, keyPath, publicKeyPath } =
      this.certificateMaterial.getPaths();
    const certPem = await fs.readFile(certificatePath, 'utf8');
    const keyPem = await fs.readFile(keyPath, 'utf8');
    const publicKeyPem = await fs.readFile(publicKeyPath, 'utf8');

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

  private async shouldReplaceMitmCa(
    mitmCaPath: string,
    expectedCertPem: string
  ): Promise<boolean> {
    try {
      const existing = await fs.readFile(mitmCaPath, 'utf8');
      return existing.trim() !== expectedCertPem.trim();
    } catch (error) {
      if (isMissingFile(error)) {
        return false;
      }
      throw error;
    }
  }

  private async clearMitmHostCertificates(mitmCertsDir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(mitmCertsDir);
    } catch (error) {
      if (isMissingFile(error)) {
        return;
      }
      throw error;
    }

    await Promise.all(
      entries
        .filter((name) => name.endsWith('.pem') && name !== 'ca.pem')
        .map((name) => fs.rm(path.join(mitmCertsDir, name), { force: true }))
    );
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
