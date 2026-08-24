import type { Profile } from '@cursor-accounts/types';

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

/** Lifecycle operations for per-profile and shared proxy runtimes. */
export interface IProxyLifecycle {
  start(profileId: string): Promise<ProxyStartResult>;
  stop(profileId: string, options?: { restoreSettings?: boolean }): Promise<void>;
  restartProfileProxy(profileId: string): Promise<ProxyStartResult>;
  isRunning(profileId: string): Promise<boolean>;
  ensureProfileProxy(profileId: string): Promise<ProxyStartResult>;
  ensureSharedProxy(profiles: Profile[]): Promise<ProxyStartResult>;
  stopAll(): Promise<void>;
  restoreAllProfileProxySettings(): Promise<RestoreAllProfilesResult>;
  connectToExistingProxy(profileId: string): Promise<void>;
}
