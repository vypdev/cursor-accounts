import type { InstanceInfoMap } from '../types';

/** Return whether any running instance belongs to the profile. */
export function isProfileRunning(
  runningInstances: InstanceInfoMap,
  profileId: string
): boolean {
  return Object.values(runningInstances).some(
    (info) => info.profileId === profileId
  );
}
