import type { Profile, ProxyInstallGuide, ProxyStatus } from '@cursor-accounts/types';

/** Result of restoring proxy settings across all managed profiles. */
export interface RestoreAllProfilesResult {
  restored: number;
  errors: Array<{ profileId: string; error: string }>;
}

/** Result of attempting to start the MITM proxy. */
export interface ProxyStartResult {
  success: boolean;
  port?: number;
  error?: string;
}

/** Port for managing per-profile MITM proxy lifecycle and status. */
export interface IProxyManager {
  start(profileId: string): Promise<ProxyStartResult>;
  stop(profileId: string, options?: { restoreSettings?: boolean }): Promise<void>;
  restartProfileProxy(profileId: string): Promise<ProxyStartResult>;
  getStatus(profileId: string): Promise<ProxyStatus | null>;
  isRunning(profileId: string): Promise<boolean>;
  isCurrentWindowUsingProxy(): Promise<boolean>;
  getCertificatePath(): Promise<string | null>;
  getLogDirectory(): string;
  getProxyInstallGuide(): Promise<ProxyInstallGuide>;
  installCertificate(): Promise<{ success: boolean; error?: string }>;
  uninstallCertificate(): Promise<{ success: boolean; error?: string }>;
  checkCertificateInstalled(): Promise<boolean>;
  getCachedCertificateInstalled(): boolean | undefined;
  getProxyServerUrl(profileId: string): Promise<string | null>;
  getAllUsedPorts(): Promise<number[]>;
  ensureProfileProxy(profileId: string): Promise<ProxyStartResult>;
  ensureSharedProxy(profiles: Profile[]): Promise<ProxyStartResult>;
  stopAll(): Promise<void>;
  restoreAllProfileProxySettings(): Promise<RestoreAllProfilesResult>;
  onStatusChange(callback: () => void): void;
  ensureOutputTailer(
    profileId: string,
    options?: { tailFromStart?: boolean; forceRestart?: boolean }
  ): Promise<void>;
  ensureTrafficTailer(): Promise<void>;
  connectToExistingProxy(profileId: string): Promise<void>;
  showOutputChannel(): void;
  showTokenDetectorChannel(): void;
}
