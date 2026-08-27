/** Prepares the CA directory consumed by the standalone MITM proxy. */
export interface IMitmCertificateDirectory {
  ensureCaDirectoryForMitm(): Promise<string>;
}
