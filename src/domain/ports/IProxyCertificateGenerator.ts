/** Generates or materializes the managed CA certificate. */
export interface IProxyCertificateGenerator {
  ensureCaCertificate(): Promise<string>;
}
