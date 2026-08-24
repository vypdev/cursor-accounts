import type { IAgentTrackingRepository } from './IAgentTrackingRepository';

/**
 * Pool of per-profile agent tracking repositories for the shared proxy child process.
 * Maintains one SQLite connection per distinct active profile.
 */
export interface IAgentTrackingDbPool {
  getRepositoryForProfile(profileId: string): Promise<IAgentTrackingRepository>;
  closeAll(): Promise<void>;
  closeProfile(profileId: string): Promise<void>;
}
