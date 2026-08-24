import type { IAgentTrackingRepository } from '../domain/ports/IAgentTrackingRepository';
import type { IDatabaseConnectionManager } from '../domain/ports/IDatabaseConnectionManager';
import { BetterSqliteAgentTrackingRepository } from './betterSqlite/betterSqliteAgentTrackingRepository';
import { BetterSqliteConnectionManager } from './betterSqlite/betterSqliteConnectionManager';
import * as extensionLog from '../logging/extensionLog';

/**
 * Factory for creating agent tracking repositories using better-sqlite3.
 */

/** Singleton connection manager (one per extension instance/window) */
let connectionManager: IDatabaseConnectionManager | undefined;

/**
 * Get or create the singleton connection manager for this extension host.
 */
function getConnectionManager(): IDatabaseConnectionManager {
  if (!connectionManager) {
    connectionManager = new BetterSqliteConnectionManager();
    extensionLog.info('[AgentTrackingFactory] Created BetterSqliteConnectionManager singleton');
  }
  return connectionManager;
}

/**
 * Create an agent tracking repository backed by better-sqlite3.
 *
 * @param dbPath - Absolute path to the SQLite database file
 * @param extensionPath - Extension root path (for migrations)
 */
export function createAgentTrackingRepository(
  dbPath: string,
  extensionPath: string
): IAgentTrackingRepository {
  extensionLog.info(`[AgentTrackingFactory] Using better-sqlite3 for: ${dbPath}`);
  return new BetterSqliteAgentTrackingRepository(
    getConnectionManager(),
    dbPath,
    extensionPath
  );
}

/**
 * Close all connections managed by the connection manager.
 * Called on extension deactivate.
 */
export async function closeAllConnections(): Promise<void> {
  if (connectionManager) {
    extensionLog.info('[AgentTrackingFactory] Closing all database connections');
    await connectionManager.closeAllConnections();
  }
}
