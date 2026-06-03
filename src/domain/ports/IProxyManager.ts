import type { ProxyInstallGuide, ProxyStatus } from '@cursor-accounts/types';

/** Result of attempting to start the MITM proxy. */
export interface ProxyStartResult {
  success: boolean;
  port?: number;
  error?: string;
}

/** Port for managing the MITM proxy lifecycle and status. */
export interface IProxyManager {
  start(): Promise<ProxyStartResult>;
  stop(): Promise<void>;
  getStatus(): Promise<ProxyStatus | null>;
  isRunning(): Promise<boolean>;
  isCurrentWindowUsingProxy(): Promise<boolean>;
  getCertificatePath(): Promise<string | null>;
  getLogDirectory(): string;
  getProxyInstallGuide(): Promise<ProxyInstallGuide>;
  installCertificate(): Promise<{ success: boolean; error?: string }>;
  uninstallCertificate(): Promise<{ success: boolean; error?: string }>;
  checkCertificateInstalled(): Promise<boolean>;
  getCachedCertificateInstalled(): boolean | undefined;
  getProxyServerUrl(): Promise<string | null>;
  onStatusChange(callback: () => void): void;
}
