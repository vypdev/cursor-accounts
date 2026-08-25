import type { Profile } from '@cursor-accounts/types';

/** Proxy data required when launching a profile. */
export interface ProfileProxyLaunchContext {
  proxyUrl: string;
  caCertPath: string;
}

/** Port for preparing a profile's proxy runtime and launch settings. */
export interface IProfileProxyLaunchCoordinator {
  resolve(
    profile: Profile,
    userDataDir: string
  ): Promise<ProfileProxyLaunchContext | null>;
}
