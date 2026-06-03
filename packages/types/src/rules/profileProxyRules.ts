import type { Profile } from '../entities/Profile';

/** Returns true when the profile should use the MITM proxy (default: enabled). */
export function isProfileProxyEnabled(profile: Pick<Profile, 'proxyEnabled'>): boolean {
  return profile.proxyEnabled !== false;
}
