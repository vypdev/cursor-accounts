import type { IAgentTrackingDbPool } from '../../domain/ports/IAgentTrackingDbPool';
import type { IAgentTrackingRepository } from '../../domain/ports/IAgentTrackingRepository';
import { BetterSqliteAgentTrackingRepository } from './betterSqliteAgentTrackingRepository';
import { BetterSqliteConnectionManager } from './betterSqliteConnectionManager';

/**
 * Manages lazy-open better-sqlite3 repositories keyed by profileId.
 * Used by the shared proxy child process for fast multi-profile persistence.
 */
export class SqliteAgentTrackingDbPool implements IAgentTrackingDbPool {
  private readonly connections = new Map<string, IAgentTrackingRepository>();
  private readonly pendingConnections = new Map<
    string,
    Promise<IAgentTrackingRepository>
  >();
  private readonly connectionManager = new BetterSqliteConnectionManager();

  constructor(
    private readonly profileDbPaths: Map<string, string>,
    private readonly extensionPath: string
  ) {}

  async getRepositoryForProfile(profileId: string): Promise<IAgentTrackingRepository> {
    const repo = this.connections.get(profileId);
    if (repo) {
      return repo;
    }

    const pending = this.pendingConnections.get(profileId);
    if (pending) {
      return pending;
    }

    const dbPath = this.profileDbPaths.get(profileId);
    if (!dbPath) {
      throw new Error(`No database path configured for profile ${profileId}`);
    }

    const initialization = this.openRepository(profileId, dbPath);
    this.pendingConnections.set(profileId, initialization);
    try {
      return await initialization;
    } finally {
      if (this.pendingConnections.get(profileId) === initialization) {
        this.pendingConnections.delete(profileId);
      }
    }
  }

  private async openRepository(
    profileId: string,
    dbPath: string
  ): Promise<IAgentTrackingRepository> {
    const repo = new BetterSqliteAgentTrackingRepository(
      this.connectionManager,
      dbPath,
      this.extensionPath
    );
    await repo.initialize();
    this.connections.set(profileId, repo);
    process.stderr.write(
      `[DbPool] Opened connection for profile ${profileId} at ${dbPath}\n`
    );
    return repo;
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.pendingConnections.values()].map((pending) =>
        pending.catch(() => undefined)
      )
    );
    this.pendingConnections.clear();
    for (const [profileId] of this.connections) {
      process.stderr.write(`[DbPool] Closed connection for profile ${profileId}\n`);
    }
    this.connections.clear();
    await this.connectionManager.closeAllConnections();
  }

  async closeProfile(profileId: string): Promise<void> {
    const pending = this.pendingConnections.get(profileId);
    if (pending) {
      await pending.catch(() => undefined);
    }

    const repo = this.connections.get(profileId);
    if (!repo) {
      return;
    }
    const dbPath = this.profileDbPaths.get(profileId);
    this.connections.delete(profileId);
    if (dbPath) {
      await this.connectionManager.closeConnection(dbPath);
    }
    process.stderr.write(`[DbPool] Closed connection for profile ${profileId}\n`);
  }
}
