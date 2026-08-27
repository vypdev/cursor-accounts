import * as forge from 'node-forge';
import { CA_COMMON_NAME } from './certificateConstants';

const CA_VALIDITY_YEARS = 10;

export interface GeneratedCertificateMaterial {
  certificatePem: string;
  keyPem: string;
  publicKeyPem: string;
}

/** Generates the canonical self-signed CA material without filesystem effects. */
export function generateCertificateMaterial(): GeneratedCertificateMaterial {
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

  return {
    certificatePem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    publicKeyPem: forge.pki.publicKeyToPem(keys.publicKey),
  };
}
