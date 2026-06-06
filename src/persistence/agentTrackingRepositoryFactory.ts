import * as vscode from 'vscode';
import type { IAgentTrackingRepository } from '../domain/ports/IAgentTrackingRepository';
import type { IDatabaseConnectionManager } from '../domain/ports/IDatabaseConnectionManager';
import { AgentTrackingDatabase } from './agentTrackingDatabase';
import { BetterSqliteAgentTrackingRepository } from './betterSqlite/betterSqliteAgentTrackingRepository';
import { BetterSqliteConnectionManager } from './betterSqlite/betterSqliteConnectionManager';
import * as extensionLog from '../logging/extensionLog';

/**
 * Factory for creating agent tracking repositories based on feature flag.
 * 
 * @remarks
 * This factory encapsulates the choice between legacy CLI (AgentTrackingDatabase)
 * and modern better-sqlite3 (BetterSqliteAgentTrackingRepository) implementations.
 * 
 * The choice is controlled by the `cursorAccounts.experimental.useBetterSqlite3`
 * setting, which defaults to false during the migration phase.
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
 * Create an agent tracking repository using the appropriate implementation.
 * 
 * @param dbPath - Absolute path to the SQLite database file
 * @param extensionPath - Extension root path (for migrations, legacy CLI binary)
 * @returns Repository instance (either legacy or better-sqlite3)
 */
export function createAgentTrackingRepository(
  dbPath: string,
  extensionPath: string
): IAgentTrackingRepository {
  const config = vscode.workspace.getConfiguration('cursorAccounts');
  const useBetterSqlite3 = config.get<boolean>('experimental.useBetterSqlite3', false);
  
  if (useBetterSqlite3) {
    extensionLog.info(`[AgentTrackingFactory] Using better-sqlite3 for: ${dbPath}`);
    return new BetterSqliteAgentTrackingRepository(
      getConnectionManager(),
      dbPath,
      extensionPath
    );
  } else {
    extensionLog.info(`[AgentTrackingFactory] Using legacy CLI for: ${dbPath}`);
    return new AgentTrackingDatabase(dbPath, extensionPath);
  }
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
