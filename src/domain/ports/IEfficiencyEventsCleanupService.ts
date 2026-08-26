/** Result returned after removing expired efficiency events. */
export interface EfficiencyEventsCleanupResult {
  removedEvents: number;
  bytesReclaimed: number;
}

/**
 * Port for removing expired efficiency events from a profile's local store.
 * The cutoff is a Unix timestamp in seconds.
 */
export interface IEfficiencyEventsCleanupService {
  cleanOldEvents(
    profileId: string,
    userDataDir: string,
    beforeTimestamp: number
  ): Promise<EfficiencyEventsCleanupResult>;
}
