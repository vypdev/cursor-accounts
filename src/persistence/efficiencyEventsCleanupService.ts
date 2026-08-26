import type {
  EfficiencyEventsCleanupResult,
  IEfficiencyEventsCleanupService,
} from '../domain/ports/IEfficiencyEventsCleanupService';
import {
  EfficiencyDatabase,
  getEfficiencyDbPath,
} from './efficiencyDatabase';

export interface EfficiencyEventsCleanupServiceDeps {
  extensionPath: string;
}

/**
 * SQLite adapter for the efficiency-events cleanup port.
 * Keeps database construction and file-size accounting out of the orchestration service.
 */
export class EfficiencyEventsCleanupService
  implements IEfficiencyEventsCleanupService
{
  constructor(private readonly deps: EfficiencyEventsCleanupServiceDeps) {}

  async cleanOldEvents(
    profileId: string,
    userDataDir: string,
    beforeTimestamp: number
  ): Promise<EfficiencyEventsCleanupResult> {
    const database = new EfficiencyDatabase(
      getEfficiencyDbPath(userDataDir),
      this.deps.extensionPath
    );
    const beforeBytes = await database.getDatabaseSize();

    await database.initialize();
    const removedEvents = await database.deleteOldEvents(
      profileId,
      beforeTimestamp
    );
    await database.vacuum();

    const afterBytes = await database.getDatabaseSize();

    return {
      removedEvents,
      bytesReclaimed: Math.max(0, beforeBytes - afterBytes),
    };
  }
}
