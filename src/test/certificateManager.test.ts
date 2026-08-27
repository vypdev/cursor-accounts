import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  CA_CERT_FILE,
  CA_KEY_FILE,
  CA_PUBLIC_KEY_FILE,
  CertificateManager,
} from '../proxy/certificateManager';
import { MitmCertificateDirectory } from '../proxy/mitmCertificateDirectory';

describe('CertificateManager', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-cert-')
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('generates CA certificate and key PEM files', async () => {
    const manager = new CertificateManager(tempDir);
    const certPath = await manager.ensureCaCertificate();

    assert.equal(certPath, path.join(tempDir, CA_CERT_FILE));
    const cert = await fs.readFile(certPath, 'utf8');
    const key = await fs.readFile(path.join(tempDir, CA_KEY_FILE), 'utf8');
    const publicKey = await fs.readFile(
      path.join(tempDir, CA_PUBLIC_KEY_FILE),
      'utf8'
    );
    assert.ok(cert.includes('BEGIN CERTIFICATE'));
    assert.ok(key.includes('BEGIN RSA PRIVATE KEY') || key.includes('BEGIN PRIVATE KEY'));
    assert.ok(publicKey.includes('BEGIN PUBLIC KEY'));
  });

  it('reuses existing certificate without regenerating', async () => {
    const manager = new CertificateManager(tempDir);
    await manager.ensureCaCertificate();
    const mtimeBefore = (await fs.stat(path.join(tempDir, CA_CERT_FILE))).mtimeMs;

    await new Promise((r) => setTimeout(r, 20));
    await manager.ensureCaCertificate();
    const mtimeAfter = (await fs.stat(path.join(tempDir, CA_CERT_FILE))).mtimeMs;

    assert.equal(mtimeBefore, mtimeAfter);
  });

  it('shares concurrent generation so all callers use one certificate path', async () => {
    const manager = new CertificateManager(tempDir);

    const paths = await Promise.all([
      manager.ensureCaCertificate(),
      manager.ensureCaCertificate(),
      manager.ensureCaCertificate(),
    ]);

    assert.deepEqual(paths, [
      path.join(tempDir, CA_CERT_FILE),
      path.join(tempDir, CA_CERT_FILE),
      path.join(tempDir, CA_CERT_FILE),
    ]);
    const certificate = await fs.readFile(paths[0]!, 'utf8');
    const key = await fs.readFile(path.join(tempDir, CA_KEY_FILE), 'utf8');
    assert.ok(certificate.includes('BEGIN CERTIFICATE'));
    assert.ok(key.includes('BEGIN RSA PRIVATE KEY') || key.includes('BEGIN PRIVATE KEY'));
  });

  it('prepares http-mitm-proxy sslCaDir layout under certs/ca.pem', async () => {
    const manager = new CertificateManager(tempDir);
    const directory = new MitmCertificateDirectory(tempDir, manager);
    const sslDir = await directory.ensureCaDirectoryForMitm();

    assert.equal(sslDir, tempDir);
    const caPem = await fs.readFile(path.join(tempDir, 'certs', 'ca.pem'), 'utf8');
    const keyPem = await fs.readFile(
      path.join(tempDir, 'keys', 'ca.private.key'),
      'utf8'
    );
    const publicKeyPem = await fs.readFile(
      path.join(tempDir, 'keys', 'ca.public.key'),
      'utf8'
    );
    const canonical = await fs.readFile(path.join(tempDir, CA_CERT_FILE), 'utf8');
    assert.equal(caPem.trim(), canonical.trim());
    assert.ok(keyPem.length > 0);
    assert.ok(publicKeyPem.length > 0);
    await assert.rejects(() => fs.access(path.join(tempDir, 'ca.pem')));
  });

  it('replaces NodeMITM CA and clears cached host certificates', async () => {
    const manager = new CertificateManager(tempDir);
    await manager.ensureCaCertificate();
    const directory = new MitmCertificateDirectory(tempDir, manager);

    const mitmCertsDir = path.join(tempDir, 'certs');
    await fs.mkdir(mitmCertsDir, { recursive: true });
    await fs.writeFile(
      path.join(mitmCertsDir, 'ca.pem'),
      'subject=NodeMITMProxyCA\n',
      'utf8'
    );
    await fs.writeFile(path.join(mitmCertsDir, 'api2.cursor.sh.pem'), 'stale', 'utf8');

    await directory.ensureCaDirectoryForMitm();

    const caPem = await fs.readFile(path.join(mitmCertsDir, 'ca.pem'), 'utf8');
    const canonical = await fs.readFile(path.join(tempDir, CA_CERT_FILE), 'utf8');
    assert.equal(caPem.trim(), canonical.trim());
    await assert.rejects(() =>
      fs.access(path.join(mitmCertsDir, 'api2.cursor.sh.pem'))
    );
  });

});
