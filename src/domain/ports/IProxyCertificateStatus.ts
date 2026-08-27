/** Reads and maintains managed CA trust-store status. */
export interface IProxyCertificateStatus {
  checkInstalled(): Promise<boolean>;
  getCachedInstalled(): boolean | undefined;
  setCachedInstalled(installed: boolean): void;
}
