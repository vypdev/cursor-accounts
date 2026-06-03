import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  CA_CERT_FILE,
  CA_KEY_FILE,
  CertificateManager,
} from '../proxy/certificateManager';

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
    assert.ok(cert.includes('BEGIN CERTIFICATE'));
    assert.ok(key.includes('BEGIN RSA PRIVATE KEY') || key.includes('BEGIN PRIVATE KEY'));
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

  it('prepares http-mitm-proxy sslCaDir layout', async () => {
    const manager = new CertificateManager(tempDir);
    const sslDir = await manager.ensureCaDirectoryForMitm();

    assert.equal(sslDir, tempDir);
    const caPem = await fs.readFile(path.join(tempDir, 'ca.pem'), 'utf8');
    const keyPem = await fs.readFile(
      path.join(tempDir, 'keys', 'ca.private.key'),
      'utf8'
    );
    assert.ok(caPem.includes('BEGIN CERTIFICATE'));
    assert.ok(keyPem.length > 0);
  });

});
