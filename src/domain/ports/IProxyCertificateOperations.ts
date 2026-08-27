export interface ProxyCertificateOperationResult {
  success: boolean;
  error?: string;
}

/** Infrastructure capabilities required by the certificate application service. */
export interface IProxyCertificateOperations {
  ensureCaCertificate(): Promise<string>;
  certificatePathExists(certificatePath: string): Promise<boolean>;
  checkInstalled(): Promise<boolean>;
  install(): Promise<ProxyCertificateOperationResult>;
  uninstall(): Promise<ProxyCertificateOperationResult>;
}
