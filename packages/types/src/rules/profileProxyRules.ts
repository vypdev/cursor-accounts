import type { Profile } from '../entities/Profile';

/** Returns true when the profile should use the MITM proxy (default: enabled). */
export function isProfileProxyEnabled(profile: Pick<Profile, 'proxyEnabled'>): boolean {
  return profile.proxyEnabled !== false;
}

/** Returns true when the profile should write MITM proxy traffic to JSONL log files. */
export function isProfileProxyJsonlLoggingEnabled(
  profile: Pick<Profile, 'proxyJsonlLoggingEnabled'>
): boolean {
  return profile.proxyJsonlLoggingEnabled === true;
}
